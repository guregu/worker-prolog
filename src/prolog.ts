import pl from "tau-prolog";
import plLists from "tau-prolog/modules/lists";
import plChrs from "tau-prolog/modules/charsio";
import plJS from "tau-prolog/modules/js";
import plRand from "tau-prolog/modules/random";
import plStats from "tau-prolog/modules/statistics";
import plFmt from "tau-prolog/modules/format";
import { betterJSON } from "./modules/json";
import { transactions, linkedModules } from "./modules/tx";
import { fetchModule } from "./modules/fetch";

plLists(pl);
plChrs(pl);
plJS(pl);
plRand(pl);
plStats(pl);
plFmt(pl);
betterJSON(pl);
transactions(pl);
linkedModules(pl);
fetchModule(pl);

// Heavily inspired by yarn/berry

export interface Parent {
	linkApp(id: string): Promise<pl.type.Module | undefined>;
}

export class Prolog {
	public session: pl.type.Session;
	public parent: Parent;
	private deferred: Promise<void>[] = [];

	public constructor(source?: string, parent?: Parent) {
		this.parent = parent!; // TODO
		this.session = pl.create();
		this.session.ctrl = this;
		this.session.consult(`
			:- use_module(library(lists)).
			:- use_module(library(js)).
			:- use_module(library(format)).
			:- use_module(library(charsio)).
		`);
		if (source) {
			this.consult(source);
			// this.session.consult(source);
		}
	}

	public async consult(src: string, options: {success?: () => void, error?: (err: pl.type.Term<1, "throw">) => void, [k: string]: unknown} = {}) {
		const p = new Promise<void>((resolve, reject) => {
			if (typeof options.success == "function") {
				const fn = options.success;
				options.success = () => {
					resolve();
					fn.call(this);
				}
			} else {
				options.success = () => {
					resolve();
				};
			}

			if (typeof options.error == "function") {
				const fn = options.error;
				options.error = function(err: pl.type.Term<1, "throw">) {
					reject(makeError("consult_error", err));
					fn.call(this, err);
				}
			} else {
				options.error = (err: unknown) => {
					reject(makeError("consult_error", err));
					console.error("invalid src text:", src);
				}
			}

			this.session.consult(src, options);
		});
		await p;
		await this.await();
	}

	public async* query(query: string): AsyncGenerator<[pl.type.Term<number, string>,  pl.Answer], void, unknown> {
		const iter = new Query(this.session, query).answer();
		for await (const [goal, answer] of iter) {
			yield [goal, answer];
		}
	}

	public defer(fn: Promise<void>) {
		console.log("deferring:", fn);
		this.deferred.push(fn);
	}

	public async await() {
		console.log("awaiting:", this.deferred);
		const fns = this.deferred;
		this.deferred = [];
		await Promise.all(fns);
	}
}

export class Stream {
	private buf: string = "";
	private onput?: (text: string, pos: number) => boolean;
	private onflush?: (buf: string) => boolean;

	public constructor(onput?: (text: string, pos: number) => boolean, onflush?: (buf: string) => boolean) {
		this.onput = onput;
		this.onflush = onflush;
	}

	public put(text: string, pos: number) {
		// TODO: fix pos
		if (this.onput) {
			return this.onput(text, pos);
		}
		this.buf += text;
		return true;
	}

	public flush() {
		if (this.onflush) {
			const result = this.onflush(this.buf);
			if (result) {
				this.buf = "";
			}
			return result;
		}
		return true;
	}

	public buffer() {
		return this.buf;
	}

	// unused stuff:
	public get(len: number, pos: number): string | null { return null; }
	public get_byte(pos: number): number { return -1; }
	public eof(): boolean | null { return false; }
	public put_byte(byte: number, pos: number): boolean | null { return null; }
	public close(): boolean { return true; }
	public size(): number { return this.buf.length; }
}

export function newStream(alias: string, onput?: (text: string, pos: number) => boolean, onflush?: (buf: string) => boolean): pl.type.Stream {
	const stream = new Stream(onput, onflush);
	return new pl.type.Stream(stream, "append", alias, "text", false, "reset");
}

export class Query {
	public thread: pl.type.Thread;
	public ask?: string;
	
	private consultErr?: pl.type.Term<number, string>;
	private outputBuf = "";
	private stream: Stream;

	public constructor(sesh: pl.type.Session, ask: string | pl.type.State[]) {
		this.thread = new pl.type.Thread(sesh);

		this.stream = new Stream(
			(text: string, pos: number) => {
				this.outputBuf += text;
				return sesh.streams["stdout"]?.stream.put(text, pos) ?? true;
			},
			(buf: string) => {
				return sesh.streams["stdout"]?.stream.flush() ?? true;
			},
		)
		this.thread.set_current_output(new pl.type.Stream(this.stream, "append", "user", "text", false, "reset"));

		if (typeof ask == "string") {
			this.ask = ask;
			this.thread.query(ask, {
				error: (ball: pl.type.Term<1, "throw">) => {
					console.log("ARGZ", arguments);
					this.consultErr = ball;
				},
			});
		} else {
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

	public async* answer(): AsyncGenerator<[pl.type.Term<number, string>,  pl.Answer], void, unknown> {
		if (this.consultErr) {
			throw this.consultErr;
		}
		while (true) {
			const answer = await this.next();
			if (!answer) {
				break;
			}
			let pt = this.thread.current_point;
			while (pt?.parent) {
				pt = pt.parent;
			}
			const goal = pt!.goal;
			yield [goal, answer];
		}
	}

	public async drain() {
		const answers = this.answer();
		for await (const [_, answer] of answers) {
			if ((answer as any).indicator == "throw/1") {
				console.error(this.thread.session.format_answer(answer));
				throw answer;
			}
		}
	}

	public output(): string {
		this.stream.flush();
		return this.outputBuf;
	}

	public tx(): pl.type.Term<number, string>[] | undefined {
		return this.thread.tx;
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
	let term: pl.type.Term<number, "error">;
	if (detail) {
		term = new pl.type.Term("error", [
			new pl.type.Term(kind, [toProlog(detail)]),
		]);
	} else {
		term = new pl.type.Term("error", []);
	}
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

		if (x instanceof Error) {
			return functor("js_error", x.name, x.message);
		}

		// hail mary
		console.log("UNKNOWN TERM???", x);
		return new pl.type.Term("???", [new pl.type.Term(`${x}`, [])]);
	}
}

export function functor(head: string, ...args: any[]): pl.type.Term<number, string> {
	return new pl.type.Term(head, args.map(toProlog));
}
