import pl from "tau-prolog";
import plLists from "tau-prolog/modules/lists";
import plJS from "tau-prolog/modules/js";

plLists(pl);
plJS(pl);

// Heavily inspired by yarn/berry

export class Prolog {
	public session: pl.type.Session;

	public constructor(source?: string) {
		this.session = pl.create();
		this.session.consult(`
			:- use_module(library(lists)).
			:- use_module(library(js)).
		`);
		if (source) {
			this.session.consult(source);
		}
	}

	private next() {
		return new Promise<pl.Answer>(resolve => {
			this.session.answer((result: any) => {
				resolve(result);
			});
		});
	}

	public async* query(query: string) {
		this.session.query(query, {
			error: function () { console.log("ERROR!!!", arguments); },
			html: false,
		});

		while (true) {
			const answer = await this.next();
			if (!answer) {
				break;
			}
			let pt = this.session.thread.current_point;
			while (pt.parent) {
				pt = pt.parent;
			}
			const goal = pt.goal;
			yield [goal, answer];
		}
	}

}

export function makeList(array: any[], cons = new pl.type.Term("[]", [])) {
	let list = cons;
	for (let i = array.length - 1; i >= 0; i--) {
		list = new pl.type.Term(".", [array[i], list]);
	}
	return list;
}
