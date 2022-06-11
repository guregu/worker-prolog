import pl from "tau-prolog";
import { JSONResponse } from "@worker-tools/json-fetch";
import { PengineMetadata } from "./pengines";
import { functor, makeError, Prolog, Query } from "./prolog";
import { makeResponse, Store } from "./unholy";
import { prologResponse } from "./response";

export interface Application {
	id: string,
	meta: PengineMetadata,
	modules: Record<string, Record<string, pl.type.Rule[]>>;
}

export class PLDO {
	state: DurableObjectState;
	pl: Prolog;
	rules: Store<pl.type.Rule[]>;

	constructor(state: DurableObjectState, env: any) {
		this.state = state;
		this.rules = new Store(this.state.storage, "rules", pl.type);
		this.state.blockConcurrencyWhile(async () => {
			this.pl = new Prolog();
			await this.load();
		});	  
	}

	async load(): Promise<Prolog> {
		const prolog = new Prolog();
		const app = this.state.id.toString();
		const rules = await this.rules.record(app);

		console.log("DA RULEZ", rules, "4APP", app);

		for (const [k, rs] of Object.entries(rules)) {
			let moduleTerm;
			const colon = k.indexOf(":");
			if (colon != -1) {
				moduleTerm = new pl.type.Term(k.slice(0, colon), []);
				let mod = prolog.session.modules[moduleTerm.id];
				if (!mod) {
					mod = new pl.type.Module(moduleTerm.id, {}, "all", {
						session: prolog.session,
						dependencies: ["system"]
					});
					// prolog.session.modules[moduleTerm.id] = mod;
				}
				mod.public_predicates[k.slice(colon+1)] = true;
			}
			
			
			for (const rule of rs) {
				if (rule.head.indicator !== ":/2") {
					const old = rule.head.clone();
					rule.head = new pl.type.Term(":", [
						moduleTerm,
						old,
					]);
				}
				console.log("added rule", app, rule, moduleTerm);
				prolog.session.add_rule(rule);
			}
		}

		return prolog;
	}

	async save() {
		const app = this.state.id.toString();
		for (const [name, mod] of Object.entries(this.pl.session.modules)) {
			if (mod.is_library) {
				continue;
			}
			console.log("savemod", app, name, mod.rules);
			this.rules.putRecord(app, name, mod.rules);
		}
	}

	dump(): string {
		let prog = "";
		for (const [name, mod] of Object.entries(this.pl.session.modules)) {
			if (mod.is_library) {
				continue;
			}
			prog += this.dumpModule(mod);
		}
		return prog;
	}

	dumpModule(mod: pl.type.Module, name?: string) {
		if (!mod || !mod.rules) {
			return "";
		}
		if (!name) {
			name = mod.id;
		}

		let prog = "";
		// const moduleTerm = new pl.type.Term(name, []);
		for (const [pi, rs] of Object.entries(mod.rules)) {
			// prog += `:- dynamic(${name}:${pi}).\n`;
			prog += `:- dynamic(${pi}).\n`;
			for (const r of rs) {
				const rule = r;
				// const rule = r.clone();
				// if (rule.head.indicator !== ":/2") {
				// 	rule.head = new pl.type.Term(":", [
				// 		moduleTerm,
				// 		rule.head
				// 	]);
				// }
				prog += rule.toString({session: this.pl.session, quoted: true}) + "\n";
			}
		}
		return prog;
	}
}

export class ApplicationDO extends PLDO {
	env: any;
	id: string;
	meta: Store<PengineMetadata>;

	constructor(state: DurableObjectState, env: any) {
		super(state, env);
		this.env = env;
		this.meta = new Store(this.state.storage, "meta", pl.type);
	}

	async fetch(request: Request) {
		const url = new URL(request.url);
		console.log("request:", url.pathname);
		this.pl = await this.load();

		this.id = url.searchParams.get("application") ?? url.hostname;
		console.log("DOID", this.id);
		
		switch (url.pathname) {
		case "/":
			return this.handleIndex(request);
		case "/set":
			return this.handleSet(request);
		case "/exec":
			return this.handleExec(request);
		case "/rules":
			return this.handleRules(request);
		case "/meta":
			return this.handleMeta(request);
		case "/dump.pl":
			return this.handleDump(request);
		default:
			console.log("404:", url.pathname);
			return new Response("not found", { status: 404 });
		}
	}

	async handleSet(request: Request): Promise<Response> {
		const id = this.state.id.toString();
		const req = await request.json() as PengineMetadata;
		req.application = this.id;
		console.log("REQUE", req);
		// this.state.blockConcurrencyWhile
		await this.meta.put(id, req);

		for (const url of req.src_urls) {
			const resp = await fetch(new Request(url));
			if (resp.status != 200) {
				throw makeError("consult_error", functor("bad_status", resp.status), url);
			}
			const prog = await resp.text();

			console.log("consulted url", url, prog.slice(0, 64));
			this.pl.session.consult(prog, {
				reconsult: true,
				url: false,
				html: false,
				success: function() {
					console.log("consulted url:", url, prog.length);
				}.bind(this),
				error: function(err: any) {
					console.error("invalid src_url text:", prog);
					throw makeError("consult_error", err, functor("src_url", url));
				}
			});
		}

		if (req.src_text) {
			this.pl.session.consult(req.src_text, {
				reconsult: true,
				url: false,
				html: false,
				success: function() {
					console.log("consulted text:", req.src_text);
				},
				error: function(err: any) {
					console.error("invalid src_text:", req.src_text);
					throw makeError("consult_error", err, "src_text");
				}
			});
		}

		return makeResponse(await this.info());
	}

	async info() {
		const meta = await this.meta.get(this.state.id.toString()) ?? {
			application: this.id,
			title: "untitled",
			src_urls: [],
		};
		return {
			id: this.id,
			meta: meta,
			modules: this.modules(),
			dump: this.dump()
		};
	}

	modules() {
		const mods: Record<string, any> = {};
		for (const [name, mod] of Object.entries(this.pl.session.modules)) {
			if (mod.is_library) {
				continue;
			}
			mods[name] = {
				rules: mod.rules,
			};
		}
		return mods;
	}

	async handleIndex(request: Request): Promise<Response> {
		return makeResponse(await this.info());
	}

	async handleMeta(request: Request): Promise<Response> {
		const id = this.state.id.toString();
		const resp = await this.meta.get(id) ?? {};
		return new JSONResponse(resp);
	}

	async handleRules(request: Request): Promise<Response> {
		const mods = this.pl.session.modules;
		return makeResponse(mods);
	}

	async handleExec(request: Request): Promise<Response> {
		const prog = await request.text();
		const query = new Query(this.pl.session, prog);
		const answers = query.answer();
		for await (const [goal, answer] of answers) {
			if (answer.indicator == "throw/1") {
				console.error(this.pl.session.format_answer(answer));
			}
		}
		await this.save();
		return new Response("true.\n");
	}

	async handleDump(request: Request): Promise<Response> {
		return prologResponse(this.dumpModule(this.pl.session.modules.app));
	}
}