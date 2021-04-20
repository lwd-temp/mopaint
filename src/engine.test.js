

// TODO: what does it look like if it's more goal oriented?
// TODO: is cache part of the program object?
//    I want to store cache in memory, and in exported files and over the network in a peer to peer setting,
//    although with different heuristics
// is the step pointers part of the program object?


function resolveMetaHistory(metaHistory) {

	const maxMHI = metaHistory.reduce((maxMHI, op) => Math.max(maxMHI, op.mhi), 0);
	const mutableMH = JSON.parse(JSON.stringify(metaHistory));

	// Note: skipping mhi of 0, at that point it should be resolved. (most loops of this type you'd want >= 0)
	for (let mhi = maxMHI; mhi > 0; mhi--) {
		for (const op of mutableMH) {
			if (op.mhi === mhi) {
				// console.log(op, mhi);
				// TODO: handle all op types?
				// TODO: make sure it matches a target, and the metahistory index of the target is less, etc.
				if (op.type === "undo") {
					for (const otherOp of mutableMH) {
						if (otherOp.id === op.target) {
							console.log("undoing", otherOp);
							mutableMH.splice(mutableMH.indexOf(otherOp), 1);
							break;
						}
					}
				} else if (op.type === "recolor") {
					for (const otherOp of mutableMH) {
						if (otherOp.id === op.target) {
							console.log("recoloring", otherOp);
							otherOp.color = op.color;
							break;
						}
					}
				}
				mutableMH.splice(mutableMH.indexOf(op), 1);
			}
		}
	}
	return mutableMH;
}

it("should resolve metahistory", () => {
	expect(resolveMetaHistory([
		{ id: "abc1", mhi: 0, type: "line", name: "Draw Line", color: "blue", },
		{ id: "abc2", mhi: 1, type: "recolor", name: "Edit Draw Line", target: "abc1", color: "green" },
		{ id: "abc3", mhi: 2, type: "undo", name: "Undo Edit Draw Line", target: "abc2" },
		{ id: "abc4", mhi: 3, type: "undo", name: "Undo Undo Edit Draw Line", target: "abc3" }, // AKA Redo
		{ id: "abc5", mhi: 0, type: "circle", name: "Draw Circle", color: "pink", },
		{ id: "abc6", mhi: 0, type: "triangle", name: "Draw Triangle", color: "red", },
		{ id: "abc7", mhi: 1, type: "undo", name: "Undo Draw Triangle", target: "abc6" },
	])).toEqual([
		{ id: "abc1", mhi: 0, type: "line", name: "Draw Line", color: "green", },
		{ id: "abc5", mhi: 0, type: "circle", name: "Draw Circle", color: "pink", },
	]);
});


function compute({ program, cache, goalNode }) {

	resolveMetaHistory(program);

}

function deleteHistory({ opsByID, cache, stepsToDelete }) {

	let computeNeeded = false;
	// for (const [id, op] of Object.entries(opsByID)) {
	// 	if (cache[id]) {

	// 	}
	// }
	const dependentOpEntries = Object.entries(opsByID).filter(([op, id]) =>
		stepsToDelete.includes(id)
	);
	// const dependencyReplacements = dependentOpEntries.map(([op, id]) => {

	// });
	for (const [op, id] of dependentOpEntries) {

		if (cache[id]) {
			delete opsByID[id];
			// delete cache[id];
		} else {
			computeNeeded = true;
		}

	}


	// TODO: non-destructive (DDDBD), prereq: metahistory

	// return {
	// 	permanentlyDelete: function () {

	// 	}
	// };
}


function loadImageFile(bytes) {
	return bytes.slice(4);
}
function crop(array, x1, x2) {
	return array.slice(x1, x2);
}



/* global it:false expect:false */
describe("compute", () => {
	test("should use cache", () => {
		compute([], { someCachedID: "some cached value" });
	});
});

test("history deletion", () => {
	// var program = {
	// 	image: [loadImageFile, [0, 0, 0, 0, 255, 255, 255, 255, 255, 0, 255, 255]],
	// 	cropped: [crop, "@@@@image"],
	// };
	var program = {
		imageFileData: {
			type: "array",
			data: [/*magic bytes (not a real format)*/0, 0, 0, 0, /*pixel data*/255, 255, 255, 255, 255, 0, 255, 255],
		},
		imageData: {
			type: "call",
			function: loadImageFile,
			inputs: {
				imageFileData: "imageFileData",
			},
			// outputs: {
			// imageData: "imageData",
			// },
		},
		croppedImageData: {
			type: "call",
			function: crop,
			inputs: {
				imageData: "imageData",
			},
			// outputs: {
			// croppedImageData: "croppedImageData",
			// },
		},
	};
	const stepsToDelete = [
		"imageFileData",
		"imageData",
	];
	expect(deleteHistory({ program, stepsToDelete }))
		.toMatchSnapshot();
});
