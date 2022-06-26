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
import { engineModule } from "./modules/engine";

plLists(pl);
plChrs(pl);
plJS(pl);
plRand(pl);
plStats(pl);
plFmt(pl);
betterJSON(pl);
engineModule(pl);
transactions(pl);
linkedModules(pl);
fetchModule(pl);

export const DEFAULT_MODULES = ["lists", "js", "format", "charsio", "engine"];
export const SYSTEM_MODULES = ["system", "engine"];
// Heavily inspired by yarn/berry

export class Prolog {
	public session: pl.type.Session;
	public parent: pl.Pengine;
	private deferred: Promise<void>[] = [];

	public constructor(source?: string, parent?: pl.Pengine) {
		this.parent = parent!; // TODO
		this.session = pl.create();
		this.session.ctrl = this;
		this.session.consult(DEFAULT_MODULES.
			map(x => `:- use_module(library(${x})).`).
			join("\n"));
		if (source) {
			this.consult(source);
			// this.session.consult(source);
		}
	}

	public async consult(src: string, options: {success?: () => void, error?: (err: pl.type.Term<1, "throw/1">) => void, [k: string]: unknown} = {}) {
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
				options.error = function(err: pl.type.Term<1, "throw/1">) {
					reject(err);
					fn.call(this, err);
				}
			} else {
				options.error = (err: unknown) => {
					reject(err);
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

	// deletes static predicates, meta predicate declarations, and multifile predicate declarations
	// useful before consulting a dump, otherwise these will stick around forever
	public resetRules() {
		for (const mod of Object.values(this.session.modules).filter(x => !x.is_library)) {
			// TODO: handle dynamic predicates as well
			// will require a different approach
			mod.multifile_predicates = {};
			mod.meta_predicates = {}
			for (const [pi, on] of Object.entries(mod.public_predicates)) {
				if (on) { continue; }
				mod.rules[pi] = [];
			}
		}
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

export const ID_EPOCH = 1656164000000;
export class Query {
	public readonly thread: pl.type.Thread;
	public readonly ask?: string;
	public readonly id = crypto.randomUUID();
	
	private consultErr?: pl.type.Term<1, "throw/1">;
	private outputBuf = "";
	private stream: Stream;

	public constructor(sesh: pl.type.Session, ask: string | pl.type.State[]) {
		const a = new Uint8Array(1);
		crypto.getRandomValues(a);
		const now = new Date();
		// attempting to generate a prolog-friendly query ID
		this.id = `${(now.getHours()+10).toString(36)}${(now.getTime()-ID_EPOCH).toString(36)}${a[0].toString(36)}`;

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
				error: (ball: pl.type.Term<1, "throw/1">) => {
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
			throw withErrorContext(this.consultErr, functor("file", "src_text"));
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
			if (pl.type.is_error(answer)) {
				console.error(this.thread.session.format_answer(answer));
				throw answer;
			}
		}
	}

	public stop() {
		this.thread.throw_error(atom("stop"));
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

export function functor(head: string, ...args: any[]): pl.type.Term<number, string> {
	return new pl.type.Term(head, args.map(toProlog));
}

export function atom(v: string): pl.type.Term<0, string> {
	return new pl.type.Term(v, []);
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

export function withErrorContext(error: pl.type.Term<2, "error/2">|pl.type.Term<1, "throw/1">, context: pl.type.Term<number, string>): pl.type.Term<2, "error/2"> {
	const err = pl.type.is_error(error) ? error.args[0] : error;
	if (pl.type.is_term(err) && pl.type.is_list(err.args[1])) {
		return new pl.type.Term("error", [error.args[0], makeList([context], err.args[1])]);
	}
	return new pl.type.Term("error", [error.args[0], makeList([context, error.args[1]])]);
}

export function toProlog(x: any): pl.type.Value {
	switch (typeof x) {
	case "number":
		return new pl.type.Num(x);
	case "string":
		return new pl.type.Term(x, []);
	case "undefined":
		return new pl.type.Term("{}", [new pl.type.Term("undefined", [])]);
	default:
		if (x === null) {
			return new pl.type.Term("{}", [new pl.type.Term("null", [])]);
		}

		if (pl.type.is_term(x) || pl.type.is_number(x) || pl.type.is_variable(x) || pl.type.is_js_object(x)) {
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
		console.warn("UNKNOWN TERM???", x);
		return functor("???", `${x}`);
	}
}

export function isEmpty(mod: pl.type.Module): boolean {
	if (!mod) {
		return true;
	}
	if (Object.keys(mod.public_predicates).length > 0) {
		return false;
	}
	if (Object.keys(mod.rules).length > 0) {
		return false;
	}
	if (mod.initialization && mod.initialization.length > 0) {
		return false;
	}
	return true;
}