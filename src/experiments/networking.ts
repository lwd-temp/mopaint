
// Networking Prototype
// Goals:
// - Transport agnostic.
//   Establish a simple protocol that could be backed by WebSockets, WebRTC, WebTransport, etc.,
//   possibly using a library like libp2p (which supports all of the above), or even a closed-source service like Firebase.
//   Also, non-network transports like `BroadcastChannel`, or `iframe.contentWindow.postMessage`, or Electron's IPC system
//   will be useful for locally syncing views of the same document across different page contexts (browser tabs, `iframe`s, or Electron `BrowserWindow`s).
//   Also, an in-process implementation is useful for testing.
// - Syncing an append-only list of operations
//   - Eventual consistency
//   - Conflict resolution can be ignored for now, as drawing operations can always be considered independently ordered
// - In the future, sharing cache data using content-addressable storage

import { ElementOfArray, OmitNever } from "../helpers.ts";

// Should there be a message type separate from the operation type?
// Probably, something like that.
// Eventually we'll want to stream buffers of data like mouse movements, associated with a single operation,
// (probably with timestamp information interleaved with the data).
// And at any rate, different applications want different types of operations,
// so we might want a generic type like Message<DrawingOperation>.
// Not sure. It's likely to end up outside of TypeScript's type system.
// We could be using rust or go in a year, or jai in 10 years.
// Or it might not make sense if a drawing app can dynamically load spreadsheet capabilities,
// meaning at compile time it's not going to know what all the operation types are.
// (I am trying to build an operating system of sorts, similar to VS Code, or a web browser, or Blender.
// A generative technology, as Jeff Lindsay puts it.)


export interface BrushOpData {
	type: "brush";
	points: { x: number, y: number }[];
	color: string;
}

export interface CircleOpData {
	type: "circle";
	x: number;
	y: number;
	color: string;
}

export type OpData = BrushOpData | CircleOpData;

export interface OpMetaData {
	timestamp: number;
	clientId: string | number;
	operationId: string;
}
export interface Operation<T extends OpData = OpData> extends OpMetaData {
	data: T;
}

// awkwardly making some fields optional with Partial and then some required again with Pick
// could split OpMetaData into OpRequiredMetaData and OpAutoMetaData, or there might be a cleaner way to do this
// export type AddOperationOptions = { data: OpData } & Partial<OpMetaData> & Pick<OpMetaData, "operationId">;

export interface AddOperationOptions<T extends OpData = OpData> extends Partial<OpMetaData> {
	data: T;
	operationId: string;
}

export type ContinuousOperationUpdate<T extends OpData = OpData> =
	// Partial<T>, // would be { points: [Point] }, but we're using { points: Point } instead (and want to omit non-array fields)
	// { [K in keyof T]: ElementOfArray<T[K]> },
	// { [K in keyof T]: T[K] extends readonly unknown[] ? ElementOfArray<T[K]> : never },
	OmitNever<{ [K in keyof T]: T[K] extends readonly unknown[] ? ElementOfArray<T[K]> : never }>;


let nextClientId = 1;
export class HistoryStore {
	clientId: number;
	metaHistory: Operation[] = [];
	localOperationListeners: Set<(operation: Operation) => void> = new Set();
	anyOperationListeners: Set<(operation: Operation) => void> = new Set();
	localOperationUpdatedListeners: Set<(operation: Operation, update: ContinuousOperationUpdate) => void> = new Set();
	anyOperationUpdatedListeners: Set<(operation: Operation, update: ContinuousOperationUpdate) => void> = new Set();

	constructor({ clientId }: { clientId?: number } = {}) {
		this.clientId = clientId ?? nextClientId++;
	}

	// computeLinearHistory() {
	// 	return resolveMetaHistory(this.metaHistory);
	// }

	/**
	 * @param operation
	 * @param remote - whether the operation was received from the network or storage, rather than generated locally in this session
	 */
	addOperation<T extends OpData>(addOperationOptions: AddOperationOptions<T>, remote = false): Operation<T> {
		// TODO: if remote, validate the operation has clientId and timestamp instead of filling them in
		// and validate the operationId is unique
		const operation: Operation<T> = Object.assign({
			timestamp: Date.now(),
			clientId: this.clientId,
		}, addOperationOptions);

		// Search backwards to find where to insert the operation
		let i = this.metaHistory.length - 1;
		for (; i >= 0; i--) {
			const otherOperation = this.metaHistory[i]!;
			if (
				otherOperation.timestamp < operation.timestamp ||
				// use client ID as a tiebreaker for equal timestamps
				// might need vector clocks or something more sophisticated in the future
				(otherOperation.timestamp === operation.timestamp && otherOperation.clientId <= operation.clientId)
			) {
				break;
			}
		}
		this.metaHistory.splice(i + 1, 0, operation);

		if (!remote) {
			for (const listener of this.localOperationListeners) {
				listener(operation);
			}
		}
		for (const listener of this.anyOperationListeners) {
			listener(operation);
		}

		return operation;
	}

	/**
	 * @param operationId
	 * @param update - new samples to append to arrays in the operation's data; should look like { points: Point }, not { points: [Point] }
	 * @param remote - whether the update was received from the network or storage, rather than generated locally in this session
	 */
	pushContinuousOperationData<T extends OpData>(
		operationId: string,
		update: ContinuousOperationUpdate<T>,
		remote = false
	) {
		// I feel like these continuously appended buffers MIGHT be better divorced from the concept of an operation, for future use cases and/or clarity.
		// I may even be able to treat the operations list and the brush stroke data similarly, if I structure it so,
		// both being append-only lists (in general, at least), and could potentially simplify the system that I'm developing.
		// It would basically mean adding indirection to the operation's continuously updatable data buffer reference.
		// It might be like a buffer ID, instead of using the operation's ID + a top-level key to identify the buffer for updating across the network.
		//
		// That said, the reason to have a separate buffer in the first place isn't a fundamental one, but rather for performance:
		// If for every update it sent either the whole operation or an "update operation" meta operation, the overhead of the operation objects would be significant.
		// So if it's better for ergonomics to deal with whole operation objects and important for performance to use ArrayBuffer objects for stroke data,
		// it may complicate a general system, and abstractions can have a performance cost as well.
		//
		// That said again, not all operations may want to pack data in the same way, so the abstraction may be necessary anyway,
		// and it may indeed be simpler, so it's worth exploring.
		//
		// Well, the other difference is that the continuous data may be considered to come from one client session,
		// and perhaps can be assumed to be ordered, whereas the operations list needs explicit ordering.

		// TODO: use a Map to look up the operation by ID in one step
		// or take Operation as a parameter instead of operationId? could avoid this type assertion, but MIGHT be less flexible
		// I mean, I guess one could always do the lookup externally if needed, so it should be fine.
		const operation = this.metaHistory.find((op) => op.operationId === operationId) as Operation<T> | undefined;
		if (!operation) {
			console.error("Operation not found:", operationId);
			return;
		}
		// TODO: record timestamp of each sample
		// Note: for-in loop looses track of the fact that the values are arrays; Object.entries is worse, because it gives `[string, any][]`, or requires a type parameter, which might be too complex, and `string` is already too general.
		// for (const [key, value] of Object.entries<{ [K in keyof T]: T[K] extends readonly unknown[] ? ElementOfArray<T[K]> : never }>(data)) {
		for (let key in update) {
			if (!(operation.data[key] instanceof Array)) {
				console.error("Operation data key is not an array:", key);
				continue;
			}
			operation.data[key].push(update[key]);
		}

		if (!remote) {
			for (const listener of this.localOperationUpdatedListeners) {
				listener(operation, update);
			}
		}
		for (const listener of this.anyOperationUpdatedListeners) {
			listener(operation, update);
		}
	}

	/**
	 * Listen for operations generated from the local client session.
	 * @param listener - The listener function to handle the operation.
	 * @returns A function to remove the listener.
	 */
	onLocalOperation(listener: (operation: Operation) => void): () => void {
		this.localOperationListeners.add(listener);
		return () => {
			this.localOperationListeners.delete(listener);
		};
	}

	/**
	 * Listen for operations from any client, local or remote.
	 * @param listener - The listener function to handle the operation.
	 * @returns A function to remove the listener.
	 */
	onAnyOperation(listener: (operation: Operation) => void): () => void {
		this.anyOperationListeners.add(listener);
		return () => {
			this.anyOperationListeners.delete(listener);
		};
	}

	/**
	 * Listen for updates to locally-generated continuous operations.
	 * @param listener - The listener function to handle the operation update.
	 * @returns A function to remove the listener.
	 */
	onLocalOperationUpdated(listener: (operation: Operation, update: ContinuousOperationUpdate) => void): () => void {
		this.localOperationUpdatedListeners.add(listener);
		return () => {
			this.localOperationUpdatedListeners.delete(listener);
		};
	}

	/**
	 * Listen for updates to continuous operations from any client, local or remote.
	 * @param listener - The listener function to handle the operation update.
	 * @returns A function to remove the listener.
	 */
	onAnyOperationUpdated(listener: (operation: Operation, update: ContinuousOperationUpdate) => void): () => void {
		this.anyOperationUpdatedListeners.add(listener);
		return () => {
			this.anyOperationUpdatedListeners.delete(listener);
		};
	}
}

/**
 * Communicates between multiple history stores in the same process.
 */
export class InProcessPeerParty {
	peers: HistoryStore[] = [];
	cleanupFns: (() => void)[] = [];

	addPeer(peer: HistoryStore) {
		this.peers.push(peer);
		this.cleanupFns.push(peer.onLocalOperation((operation) => {
			for (const otherPeer of this.peers) {
				if (otherPeer !== peer) {
					const operationCopy = JSON.parse(JSON.stringify(operation));
					otherPeer.addOperation(operationCopy, true);
				}
			}
		}));
		this.cleanupFns.push(peer.onLocalOperationUpdated((operation, update) => {
			for (const otherPeer of this.peers) {
				if (otherPeer !== peer) {
					const updateCopy = JSON.parse(JSON.stringify(update));
					otherPeer.pushContinuousOperationData(operation.operationId, updateCopy, true);
				}
			}
		}));
	}

	dispose() {
		for (const cleanup of this.cleanupFns) {
			cleanup();
		}
	}
}

/**
 * Communicates with a WebSocket server. (See server.ts)
 */
export class MopaintWebSocketClient {
	ws: WebSocket;
	constructor(public store: HistoryStore, url: string) {
		this.ws = new WebSocket(url, "mopaint-net-demo");

		const pendingMessages: string[] = [];
		this.ws.addEventListener("open", () => {
			console.log("Connected to WebSocket server");
			for (const message of pendingMessages) {
				// console.log("Sending queued message:", message);
				this.ws.send(message);
			}
		});

		this.ws.addEventListener("close", () => {
			console.log("Disconnected from WebSocket server");
		});

		this.ws.addEventListener("message", (event) => {
			// Receive operations from the server
			if (typeof event.data !== "string") {
				console.error("Received non-string message:", event.data);
				return;
			}
			const message = JSON.parse(event.data);
			if (message.type === "operation") {
				this.store.addOperation(message.operation, true);
			} else if (message.type === "operationUpdate") {
				this.store.pushContinuousOperationData(message.operationId, message.update, true);
			}
		});

		// TODO: DRY
		this.store.onLocalOperation((operation) => {
			// Send local operations to the server
			const message = JSON.stringify({ type: "operation", operation });
			if (this.ws.readyState === WebSocket.OPEN) {
				// console.log("Sending operation to server:", operation);
				this.ws.send(message);
			} else {
				// console.log("WebSocket not open, queueing message for operation:", operation);
				pendingMessages.push(message);
			}
		});

		this.store.onLocalOperationUpdated((operation, update) => {
			// Send local operation updates to the server
			const message = JSON.stringify({ type: "operationUpdate", operationId: operation.operationId, update });
			if (this.ws.readyState === WebSocket.OPEN) {
				// console.log("Sending operation update to server:", operation, update);
				this.ws.send(message);
			} else {
				// console.log("WebSocket not open, queueing message for operation update:", operation, update);
				pendingMessages.push(message);
			}
		});
	}

	dispose() {
		this.ws.close();
	}
}

