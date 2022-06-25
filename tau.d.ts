/* eslint-disable */

/*

This file originally taken from from yarn/berry.

BSD 2-Clause License

Copyright (c) 2016-present, Yarn Contributors.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

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


declare module 'tau-prolog' {
	namespace pl {
	  namespace type {
		type _Value = Var|Num|Term<number, string>|Substitution|State|Rule|Stream|JSValue;
		type Value = Var|Num|Term<number, string>|JSValue;      
  
		class Var {
		  // private property to ensure types don't overlap
		  private _uniqueProperty;
  
		  public readonly id: string;
  
		  public constructor(id: string);
  
		  public unify(obj: _Value, occurs_check: boolean): Substitution|null;
  
		  public clone(): this;
  
		  public equals(obj: _Value): boolean;
  
		  public rename(thread: Thread): this;
  
		  public variables(): string[];
  
		  public apply(subs: Substitution): this;
  
		  public compare(other: this): -1|0|1;

		  public toString(options?: StringOptions, priority?: number): string;
		}
  
		class Num {
		  // private property to ensure types don't overlap
		  private _uniqueProperty;
  
		  public readonly is_float: boolean;
  
		  public readonly value: number;
  
		  public constructor(value: number, is_float?: boolean);
  
		  public unify(obj: _Value, occurs_check: boolean): Substitution|null;
  
		  public clone(): this;
  
		  public equals(obj: _Value): boolean;
  
		  public rename(thread: Thread): this;
  
		  public variables(): string[];
  
		  public apply(subs: Substitution): this;
  
		  public compare(other: this): -1|0|1;

		  public toString(options?: StringOptions, priority?: number): string;
		}
  
		class Term<Arity extends number, Indicator extends string> {
		  // private property to ensure types don't overlap
		  private _uniqueProperty;
  
		  public readonly indicator: Indicator;
  
		  public readonly id: string;
  
		  public readonly args: Value[]&{length: Arity};
  
		  public constructor(id: string, args?: Value[], ref?: number);
  
		  public unify(obj: _Value, occurs_check: boolean): Substitution|null;
  
		  public clone(): this;
  
		  public equals(obj: _Value): boolean;
  
		  public rename(thread: Thread): this;
  
		  public variables(): string[];
  
		  public apply(subs: Substitution): this;
  
		  public select(): Term<number, string>;
  
		  public replace(term: Term<number, string>): Term<number, string>;
  
		  public search(expr: Term<number, string>): boolean;
  
		  public compare(other: this): -1|0|1;
  
		  public toJavaScript(): string|number|(string|number)[];
  
		  public toString(options?: StringOptions, priority?: number): string;
		}
  
		class Substitution {
		  // private property to ensure types don't overlap
		  private _uniqueProperty;
  
		  public readonly links: Record<string, pl.type.Value>;
  
		  public constructor(links?: typeof this.links);
  
		  public clone(): this;
  
		  public equals(obj: _Value): boolean;
  
		  public apply(subs: Substitution): this;
		}
  
		class State {
		  // private property to ensure types don't overlap
		  private _uniqueProperty;
  
		  public readonly goal: Term<number, string>;
  
		  public readonly substitution: Substitution;
  
		  public readonly parent: State|null;
  
		  public constructor(goal?: Term<number, string>, subs?: Substitution, parent?: State);
  
		  public clone(): this;
  
		  public equals(obj: _Value): boolean;
		}
  
		class Rule {
		  // private property to ensure types don't overlap
		  private _uniqueProperty;
  
		  public readonly head: Term<number, string>;
  
		  public readonly body: Term<number, string>|null;
  
		  public readonly dynamic: boolean;
  
		  public constructor(
			head: Term<number, string>, body: Term<number, string>|null, dynamic?: boolean);
  
		  public clone(): this;
  
		  public equals(obj: _Value): boolean;
  
		  public rename(thread: Thread): this;
  
		  public variables(): string[];
  
		  public apply(subs: Substitution): this;

		  public toString(options?: StringOptions, priority?: number): string;
		}

		interface StringOptions {
			session?: Session;
			quoted?: boolean;
			ignore_ops?: boolean;
			numbervars?: boolean;
			variable_names?: Term<2, ".">;
		}
  
		class Session {
		  // private property to ensure types don't overlap
		  private _uniqueProperty;
  
		  public readonly rules: Record<string, Rule>;
  
		  public readonly modules: Record<string, Module>;

		  public readonly streams: Record<string, Stream>;
		  public standard_input?: Stream;
		  public standard_output?: Stream;
		  public standard_error?: Stream;
  
		  public readonly threads: Thread[];
  
		  public readonly thread: Thread;
  
		  public readonly total_threads: number;
  
		  public constructor(limit?: number);
  
		  public consult(program: string, options?: {
			session?: Session;
			success?: () => void;
			error?: (err: Term<1, "throw/1">) => void;
			reconsult?: boolean;
			context_module?: string;
			term_expansion?: boolean;
		  }): void;
  
		  public query(query: string, options?: any): true | Term<1, 'throw'>;
  
		  public answer(callback: (answer: Answer) => void): void;
  
		  public answers(callback: (answer: Answer) => void, maxCount?: number, after?: () => void):
		  void;
  
		  public add_rule(rule: Rule, options?: {from?: string}): true;
  
		  public prepend(states: State[]): void;
  
		  public throw_error(error: Term<number, string>): void;
  
		  public success(state: State, parent?: State): void;

		  public get_stream_by_alias(alias: string): Stream | undefined;

		  public get_current_output(): Stream | undefined;

		  public get_current_input(): Stream | undefined;
		 
		  public set_current_output(stream: Stream);
		  
		  public set_current_input(stream: Stream);

		  public get_warnings(): string[];

		  public format_answer(answer: Answer | Term<1, "throw">, thread?: Thread, options?: {}): string;

		  // not part of tau-prolog -- hack for worker-prolog (Query interface)
		  public ctrl: {
			defer: (fn: Promise<void>) => void;
			parent: Pengine;
		  };
		}
  
		class Thread {
		  // private property to ensure types don't overlap
		  private _uniqueProperty;
  
		  public readonly epoch: number;
		  public readonly session: Session;
		  public readonly total_steps: Number;
		  public readonly cpu_time: Number;
		  public readonly cpu_time_last: Number;
		  public /*readonly*/ points: State[];
		  public readonly debugger: boolean;
		  public readonly debugger_states: [];
		  public readonly level: string;
		  public readonly current_limit: number;
		  public readonly current_point?: State;

		  public constructor(session: Session);
  
		  public consult(program: string): void;
  
		  public query(query: string, options?: {
			success?: () => void;
			error?: (ball: pl.type.Term<1, "throw/1">) => void;
		  }): void;
  
		  public answer(callback: (answer: Answer) => void): void;
  
		  public answers(callback: (answer: Answer) => void, maxCount?: number, after?: () => void):
		  void;
  
		  public add_rule(rule: Rule, options?: {from?: string}): true;
  
		  public prepend(states: State[]): void;
  
		  public throw_error(error: Term<number, string>): void;
  
		  public success(state: State, parent?: State): void;
		  public again(): void;

		  public get_stream_by_alias(alias: string): Stream | undefined;

		  public get_current_output(): Stream | undefined;

		  public get_current_input(): Stream | undefined;
		 
		  public set_current_output(stream: Stream);
		  
		  public set_current_input(stream: Stream);

		  public get_warnings(): string[];

		  public format_answer(answer: Answer | Term<1, "throw/1">, thread?: Thread, options?: {session?: Session}): string;

		  // custom worker-prolog extension
		  public tx?: Term<number, string>[];
		}
  
		interface PredicateFn {
		  (thread: Thread, point: State, atom: Term<number, string>): void|true;
		}
  
		type Predicate = Rule[]|PredicateFn;
  
		class Module {
		  public readonly id: string;
  
		  public readonly predicates: Record<string, Predicate>;
  
		  public readonly exports: string[];

		  public readonly dependencies: string[];
		  public readonly modules: Record<string, Module>; // dependencies

		  public /*readonly*/ public_predicates: Record<string, boolean>;
		  public /*readonly*/ multifile_predicates: Record<string, boolean>;
		  public /*readonly*/ meta_predicates: Record<string, pl.type.Term<number, string>>;


		  public readonly is_library: boolean;

		  public readonly rules: Record<string, Rule[]>;
  
		  public constructor(id: string, predicates: Record<string, Predicate>, exports: string[]);
  
		  public exports_predicate(indicator: string): boolean;

		  public is_public_predicate(indicator: string): boolean;

		  // worker-prolog only:
		  public initialization?: pl.type.Term<1, string>[]; // initialization/1 goals
		}

		class Stream {
			public readonly id: number;
			public readonly stream: {
				get: (len: number, pos: number) => string | null;
				get_byte: (pos: number) => number | -1;
				eof: () => boolean | null;
				put: (text: string, pos: number) => boolean | null;
				put_byte: (byte: number, pos: number) => boolean | null;
				flush: () => boolean | null;
				close: () => boolean | null;
				size: () => number;
			};
			public readonly mode: "read" | "write" | "append";
			public readonly alias?: string;
			public readonly type: "text" | "binary";
			public readonly reposition: boolean;
			public readonly eof_action: "error" | "eof_code" | "reset";
			public readonly position: number;
			public readonly line_position: number;
			public readonly line_count: number;
			public readonly char_count: number;
			public readonly output: boolean;
			public readonly input: boolean;

			public constructor(stream: typeof this.stream, mode: typeof this.mode, alias?: string,
				 type?: typeof this.type, reposition?: boolean, eof_action?: typeof this.eof_action);

			public clone(): this;
			public equals(obj: _Value): boolean;
			public rename(thread: Thread): this;
			public variables(): string[];
			public apply(subs: Substitution): this;
			public compare(other: this): -1|0|1;
			public toString(options?: StringOptions, priority?: number): string;
		}

		class JSValue<T = any> {
			public readonly value: T;

			public constructor(value: T);

			public unify(obj: _Value, occurs_check: boolean): Substitution|null;
			public clone(): this;
			public equals(obj: _Value): boolean;
			public rename(thread: Thread): this;
			public variables(): string[];
			public apply(subs: Substitution): this;
			public compare(other: this): -1|0|1;
			public toString(options?: StringOptions, priority?: number): string;
		}
  
		function is_variable(obj: any): obj is Var;
		function is_number(obj: any): obj is Num;
  		function is_atom(obj: any): obj is Term<0, string>;
		function is_term(obj: any): obj is Term<number, string>;
  		function is_module(obj: any): obj is Term<1, "module/1">;
  		function is_error(obj: any): obj is Term<1, "throw/1">;
  		function is_list(obj: any): obj is Term<2, "./2">;
		function is_instantiated_list(obj: any): obj is Term<2, "./2">;
		function is_substitution(obj: any): obj is Substitution;
  
		// js module
		function is_js_object(obj: any): obj is JSValue;
	  }
  
	  namespace error {
		function existence(type: string, object: type.Term<number, string>|string, indicator: string): type.Term<1, "error/1">;
		function type(expected: string, found: Value, indicator: string): type.Term<1, "error/1">;
		function instantiation(indicator: string): type.Term<1, "error/1">;
		function domain(expected: string, found: type.Term<number, string>, indicator: string): type.Term<1, "error/1">;
		function representation(flag: string, indicator: string): type.Term<1, "error/1">;
		function permission(
		  operation: string, type: string, found: type.Term<number, string>, indicator: string): type.Term<1, "error/1">;
		function evaluation(error: string, indicator: string): type.Term<1, "error/1">;
		function syntax(
		  token: undefined|
		  {value: string, line: number, column: number, matches: string[], start: number},
		  expected: string,
		  last: boolean): type.Term<1, "error/1">;
		function syntax_by_predicate(expected: string, indicator: string): type.Term<1, "error/1">;
	  }

	  namespace util {
		function str_indicator(str: string): type.Term<2, "//2">;
	  }
	  
	  type Answer = type.Substitution | type.Term<1, "throw/1">;

	  function format_answer(answer: Answer): string;

	  interface ErrorInfo {
		type: string,
		thrown: string | null;
		expected: string | null;
		found: string | null;
		representation: string | null;
		existence: string | null;
		existence_type: string | null;
		line: string | null;
		column: string | null;
		permission_operation: string | null;
		permission_type: string | null;
		evaluation_type: string | null;
	  }

	  function flatten_error(term: type.Term<number, string>): ErrorInfo;
	  
	  function create(limit?: number): type.Session;

	  class Pengine {
		id: string;
		queries: Map<string, Query>;
		linkApp(id: string): Promise<type.Module | undefined>;
		stop(id?: string);
	  }
	}
  
	export = pl;
  }

  declare module "tau-prolog/modules/js" {
	declare const js: (pl: any) => void;
	export default js;
  }

  declare module "tau-prolog/modules/lists" {
	declare const lists: (pl: any) => void;
	export default lists;
  }

  declare module "tau-prolog/modules/charsio" {
	declare const charsio: (pl: any) => void;
	export default charsio;
  }
  
  declare module "tau-prolog/modules/random" {
	declare const random: (pl: any) => void;
	export default random;
  }
  
  declare module "tau-prolog/modules/statistics" {
	declare const statistics: (pl: any) => void;
	export default statistics;
  }

  declare module "tau-prolog/modules/format" {
	declare const format: (pl: any) => void;
	export default format;
  }
