import pl from "tau-prolog";
import plLists from "tau-prolog/modules/lists";
import plJS from "tau-prolog/modules/js";
import plRand from "tau-prolog/modules/random";
import plStats from "tau-prolog/modules/statistics";
import plFmt from "tau-prolog/modules/format";
import plChrs from "tau-prolog/modules/charsio";

/* eslint-disable prefer-rest-params */

plLists(pl);
plJS(pl);
plRand(pl);
plStats(pl);
plFmt(pl);
plChrs(pl);
betterJSON(pl);
transactions(pl);
linkedModules(pl);
fetchModule(pl);

// Heavily inspired by yarn/berry

export class Prolog {
	public session: pl.type.Session;
	public owner: unknown;
	private deferred: Promise<void>[] = [];

	public constructor(source?: string, owner?: unknown) {
		this.owner = owner;
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

	public async consult(src: string, options = {}) {
		const p = new Promise<void>((resolve, reject) => {
			if (typeof options.success == "function") {
				const fn = options.success;
				options.success = () => {
					resolve();
					fn.call(this, arguments);
				}
			} else {
				options.success = () => {
					resolve();
				};
			}

			if (typeof options.error == "function") {
				const fn = options.error;
				options.error = function(err: unknown) {
					reject(makeError("consult_error", err));
					fn.call(this, arguments);
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

	private next() {
		return new Promise<pl.Answer>(resolve => {
			this.session.answer((result: any) => {
				resolve(result);
			});
		});
	}

	public async* query(query: string) {
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
	private onput?: (text: string) => boolean;
	private onflush?: () => boolean;

	public constructor(onput?: (text: string) => boolean, onflush?: () => boolean) {
		this.onput = onput;
		this.onflush = onflush;
	}

	public put(text: string) {
		if (this.onput) {
			return this.onput(text);
		}
		this.buf += text;
		return true;
	}

	public flush() {
		if (this.onflush) {
			return this.onflush();
		}
		return true;
	}

	public buffer() {
		return this.buf;
	}
}

export function newStream(alias: string, onput?: (text: string) => boolean, onflush?: () => boolean): pl.type.Stream {
	const stream = new Stream(onput, onflush);
	return new pl.type.Stream(stream, "append", alias, "text", false, "reset");
}

export class Query {
	public thread: pl.type.Thread;
	public ask?: string;
	
	private consultErr: pl.type.Term;
	private outputBuf = "";
	private stream;

	public constructor(sesh: pl.type.Session, ask: string | pl.type.Point[]) {
		this.thread = new pl.type.Thread(sesh);

		this.thread.set_current_output();
		this.stream = new pl.type.Stream({
			put: (text: string) => {
				this.outputBuf += text;
				return sesh.streams["stdout"]?.stream.put(text) ?? true;
			},
			flush: () => {
				return sesh.streams["stdout"]?.stream.flush() ?? true;
			},
		}, "append", "user", "text", false, "reset");
		this.thread.set_current_output(this.stream);

		if (typeof ask == "string") {
			this.ask = ask;
			this.thread.query(ask, {
				error: function (ball: pl.type.Term) {
					console.log("ARGZ", arguments);
					this.consultErr = ball;
				}.bind(this),
				html: false,
			});
			return;
		} 
		this.thread.points = ask;
	}
	
	private next() {
		return new Promise<pl.Answer>(resolve => {
			this.thread.answer((result: any) => {
				resolve(result);
			});
		});
	}

	public async* answer() {
		if (this.consultErr) {
			yield [new pl.type.Term("consult", [new pl.type.Term("src_text", [])]), this.consultErr];
		}
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
			// console.log("answer:", goal.toString({session: this.thread.session, ignore_ops: false, quoted: true}));
			yield [goal, answer];
		}
	}

	public async drain() {
		const answers = this.answer();
		for await (const [_, answer] of answers) {
			if (answer.indicator == "throw/1") {
				console.error(this.thread.session.format_answer(answer));
				throw answer;
			}
		}
	}

	public output(): string {
		this.stream.stream.flush();
		return this.outputBuf;
	}

	public tx(): pl.type.Term[] | undefined {
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

function betterJSON(pl, functor = "{}") {
	// JS → Prolog
	pl.fromJavaScript.conversion.boolean = function(obj) {
		return new pl.type.Term(functor, [
			new pl.type.Term(obj ? "true" : "false", [])
		]);
	};
	const js2term = pl.fromJavaScript.conversion.object;
	pl.fromJavaScript.conversion.object = function(obj) {
		if (obj === null) {
			return new pl.type.Term(functor, [
				new pl.type.Term("null", [])
			]);
		}
		return js2term.apply(this, arguments);
	};

	// Prolog → JS
	const term2js = pl.type.Term.prototype.toJavaScript;
	pl.type.Term.prototype.toJavaScript = function() {
		if (this.indicator == functor + "/1") {
			switch (this.args[0].indicator) {
			case "true/0": return true;
			case "false/0": return false;
			case "null/0": return null;
			case "undefined/0": return undefined;
			}
		}
		return term2js.apply(this, arguments);
	};
}

function transactions(pl) {
	function replace(pi) {
		const pred = pl.builtin.rules[pi];
		pl.builtin.rules[pi] = function(thread: pl.type.Thread, point: pl.type.Point, atom: pl.type.Term) {
			if (!thread.tx) {
				thread.tx = [];
			}
			thread.tx.push(atom);
			pred.apply(this, arguments);
		};
	}
	for (const pi of ["asserta/1", "assertz/1", "retract/1", /*"retractall/1",*/ "abolish/1"]) {
		replace(pi);
	}
}

function linkedModules(pl: pl) {
	const useMod = pl.directive["use_module/1"];
	pl.directive["use_module/1"] = function(thread: pl.type.Thread, term: pl.type.Term, options?: {}) {
		// console.log("hello~", term.toString());
		const id = term.args[0];
		if (pl.type.is_term(id) && pl.type.is_atom(id.args[0])) {
			if (id.indicator === "application/1") {
				const name = id.args[0].id;
				console.log("linking app...", id.toString());
				thread.session.ctrl.defer(thread.session.ctrl.owner.linkApp(name));
				return true;
			}
		}
		useMod.apply(this, arguments);
	}
}

/*

fetchModule is a hacked verison of js module from Tau.

BSD 3-Clause License

Copyright (c) 2017-2020, José Antonio Riaza Valverde
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

*/

function fetchModule(pl: pl) {
	pl.modules.js.rules["ajax/4"] = function( thread: pl.type.Thread, point: pl.type.Point, atom: pl.type.Term ) {
		var method = atom.args[0], url = atom.args[1], value = atom.args[2], options = atom.args[3];
		if(pl.type.is_variable(url) || pl.type.is_variable(method) || pl.type.is_variable(options)) {
			thread.throw_error( pl.error.instantiation( atom.indicator ) );
		} else if(!pl.type.is_atom(url)) {
			thread.throw_error( pl.error.type( "atom", url, atom.indicator ) );
		} else if(!pl.type.is_atom(method)) {
			thread.throw_error( pl.error.type( "atom", method, atom.indicator ) );
		} else if(!pl.type.is_list(options)) {
			thread.throw_error( pl.error.type( "list", options, atom.indicator ) );
		} else if(["connect", "delete", "get", "head", "options", "patch", "post", "put", "trace"].indexOf(method.id) === -1) {
			thread.throw_error( pl.error.domain( "http_method", method, atom.indicator ) );
		} else {
			var pointer = options;
			var opt_type = null;
			var opt_timeout = 0;
			var opt_credentials = "false";
			var opt_async = "true";
			var opt_mime = null;
			var opt_headers = [];
			var opt_body = new FormData();
			var opt_user = null;
			var opt_password = null;
			// Options
			while(pl.type.is_term(pointer) && pointer.indicator === "./2") {
				var option = pointer.args[0];
				if(!pl.type.is_term(option) || option.args.length !== 1) {
					thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
					return;
				}
				var prop = option.args[0];
				// type/1
				if(option.indicator === "type/1") {
					if(!pl.type.is_atom(prop) || prop.id !== "text" && prop.id !== "json" && prop.id !== "document") {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					opt_type = prop.id;
				// user/1
				} else if(option.indicator === "user/1") {
					if(!pl.type.is_atom(prop)) {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					opt_user = prop.id;
				// password/1
				} else if(option.indicator === "password/1") {
					if(!pl.type.is_atom(prop)) {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					opt_password = prop.id;
				// timeout/1
				} else if(option.indicator === "timeout/1") {
					if(!pl.type.is_integer(prop) || prop.value < 0) {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					opt_timeout = prop.value;
				// async/1
				} else if(option.indicator === "async/1") {
					if(!pl.type.is_atom(prop) || prop.id !== "true" && prop.id !== "false") {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					opt_async = prop.id;
				// credentials/1
				} else if(option.indicator === "credentials/1") {
					if(!pl.type.is_atom(prop) || prop.id !== "true" && prop.id !== "false") {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					opt_credentials = prop.id;
				// mime/1
				} else if(option.indicator === "mime/1") {
					if(!pl.type.is_atom(prop)) {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					opt_mime = prop.id;
				// headers/1
				} else if(option.indicator === "headers/1") {
					if(!pl.type.is_list(prop)) {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					var hpointer = prop;
					while(pl.type.is_term(hpointer) && hpointer.indicator === "./2") {
						var header = hpointer.args[0];
						if(!pl.type.is_term(header) || header.indicator !== "-/2" || !pl.type.is_atom(header.args[0]) || !pl.type.is_atom(header.args[1])) {
							thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
							return;
						}
						opt_headers.push({header: header.args[0].id, value: header.args[1].id});
						hpointer = hpointer.args[1];
					}
					if(pl.type.is_variable(hpointer)) {
						thread.throw_error( pl.error.instantiation( atom.indicator ) );
						return;
					} else if(!pl.type.is_term(hpointer) || hpointer.indicator !== "[]/0") {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
				// body/1
				} else if(option.indicator === "body/1") {
					if(!pl.type.is_list(prop) && (pl.type.is_dom_object === undefined || !pl.type.is_dom_object(prop)) && !pl.type.is_atom(prop)) {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					if(pl.type.is_list(prop)) {
						var hpointer = prop;
						while(pl.type.is_term(hpointer) && hpointer.indicator === "./2") {
							var body = hpointer.args[0];
							if(!pl.type.is_term(body) || body.indicator !== "-/2" || !pl.type.is_atom(body.args[0]) || !pl.type.is_atom(body.args[1])) {
								thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
								return;
							}
							opt_body.append(body.args[0].id, body.args[1].id);
							hpointer = hpointer.args[1];
						}
						if(pl.type.is_variable(hpointer)) {
							thread.throw_error( pl.error.instantiation( atom.indicator ) );
							return;
						} else if(!pl.type.is_term(hpointer) || hpointer.indicator !== "[]/0") {
							thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
							return;
						}
					} else if(pl.type.is_atom(prop)) {
						opt_body = prop.id;
					} else {
						opt_body = prop.value;
					}
				// otherwise
				} else {
					thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
					return;
				}
				pointer = pointer.args[1];
			}
			if(pl.type.is_variable(pointer)) {
				thread.throw_error( pl.error.instantiation( atom.indicator ) );
				return;
			} else if(!pl.type.is_term(pointer) || pointer.indicator !== "[]/0") {
				thread.throw_error( pl.error.type( "list", options, atom.indicator ) );
				return;
			}

			// Request			
			const headers = new Headers();
			if (opt_user && opt_password) {
				headers.set('Authorization', 'Basic ' + atob(opt_user + ":" + opt_password));
			}
			for (const hdr of opt_headers) {
				headers.set(hdr.header, hdr.value);
			}
			fetch(new Request(url.id, {
				method: method.id.toUpperCase(),
			})).then(async (resp: Response) => {
				if (!resp.ok) {
					// ?
					throw(resp.status)
					return;
				}

				let term: pl.type.Term;
				if (resp.headers.get("Content-Type")?.includes("application/json")) {
					term = pl.fromJavaScript.apply(await resp.json());
				} else {
					// TODO: DOM
					term = new pl.type.Type(await resp.text(), []);
				}
				console.log("fetched", url.id, term);
				thread.prepend([
					new pl.type.State(
						point.goal.replace(new pl.type.Term("=", [value, term])),
						point.substitution,
						point
					)
				]);
				thread.again();
			});
			return true;
		}
	}
}