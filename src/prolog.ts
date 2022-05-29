import pl from "tau-prolog";
import plLists from "tau-prolog/modules/lists";
import plJS from "tau-prolog/modules/js";
import plRand from "tau-prolog/modules/random";
import plStats from "tau-prolog/modules/statistics";
import plFmt from "tau-prolog/modules/format";

plLists(pl);
plJS(pl);
plRand(pl);
plStats(pl);
plFmt(pl);

// Heavily inspired by yarn/berry

export class Prolog {
	public session: pl.type.Session;

	public constructor(source?: string) {
		this.session = pl.create();
		this.session.consult(`
			:- use_module(library(lists)).
			:- use_module(library(js)).
			:- use_module(library(format)).
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

	public async* query(query?: string) {
		const iter = new Query(this.session, query).answer();

		// if (query) {
		// 	thread.query(query, {
		// 		error: function () { console.log("ERROR!!!", arguments); },
		// 		html: false,
		// 	});
		// }

		for await (const [goal, answer] of iter) {
			yield [goal, answer];
		}
	}

}

export class Query {
	public thread: pl.type.Thread;
	public ask?: string;

	public constructor(sesh: pl.type.Session, ask: string | pl.type.Point[]) {
		this.thread = new pl.type.Thread(sesh);
		if (typeof ask == "string") {
			this.ask = ask;
			this.thread.query(ask, {
				error: function () { console.log("ERROR!!!", arguments); },
				html: false,
			});
			return;
		} 
		for (const pt of ask) {
			this.thread.points = ask;
		}
	}
	
	private next() {
		return new Promise<pl.Answer>(resolve => {
			this.thread.answer((result: any) => {
				resolve(result);
			});
		});
	}

	public async* answer() {
		while (true) {
			const answer = await this.next();
			if (!answer) {
				break;
			}
			let pt = this.thread.current_point;
			while (pt.parent) {
				pt = pt.parent;
			}
			const goal = pt.goal;
			yield [goal, answer];
		}
	}

	public more(): boolean {
		return this.thread.points.length > 0;
	}
}

export function makeList(array: pl.type.Value[] = [], cons = new pl.type.Term("[]", [])) {
	let list = cons;
	for (let i = array.length - 1; i >= 0; i--) {
		list = new pl.type.Term(".", [array[i], list]);
	}
	return list;
}

// returns a Prolog term like: error(kind(detail), context(ctx)).
export function makeError(kind: string, detail?: any, context?: any): pl.type.Term<number, "error"> {
	const term: pl.type.Term<number, "error"> = new pl.type.Term("error", [
		new pl.type.Term(kind, detail ? [toProlog(detail)] : []),
	]);
	if (context) {
		const ctx = new pl.type.Term("context", [toProlog(context)]);
		term.args.push(ctx);
	}
	return term;
}

export function toProlog(x: any): pl.type.Value {
	switch (typeof x) {
	case "number":
		return new pl.type.Num(x);
	case "string":
		return new pl.type.Term(x, []);
	case "undefined":
		return new pl.type.Term("@", [new pl.type.Term("undefined", [])]);
	default:
		if (x === null) {
			return new pl.type.Term("@", [new pl.type.Term("null", [])]);
		}

		if (x instanceof pl.type.Term || 
				x instanceof pl.type.Num || 
				x instanceof pl.type.Var) {
			return x;
		}
		
		// lists
		if (Array.isArray(x)) {
			const vals = x.map(v => toProlog(v));
			return makeList(vals);
		}

		// hail mary
		return new pl.type.Term("???", [new pl.type.Term(`${x}`, [])]);
	}
}

export function functor(head: string, ...args: any[]): pl.type.Term<number, string> {
	return new pl.type.Term(head, args.map(toProlog));
}