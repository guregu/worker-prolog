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
			this.pl = await this.load();
		});	  
	}

	async load(): Promise<Prolog> {
		const prolog = new Prolog();
		const rules = await this.rules.record();

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
				prolog.session.add_rule(rule);
				console.log("ADD RULE", k, rule.toString());
			}
		}

		return prolog;
	}

	async debugdump() {
		const all = await this.rules.record();
		console.log("____DEBUG DUMP___", all);
	}

	async save() {
		for (const [name, mod] of Object.entries(this.pl.session.modules)) {
			if (mod.is_library) {
				continue;
			}
			console.log("savemod?", name, mod.rules);
			await this.rules.putRecord(name, mod.rules);
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

		this.id = url.searchParams.get("application") ?? url.hostname;
		console.log("DOID", this.id);
		await this.debugdump();

		if (request.headers.get("Upgrade") == "websocket") {
			return this.handleWebsocket(request);
		}
		
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
		const req = await request.json() as PengineMetadata;
		req.application = this.id;
		await this.meta.put(req);

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

	dumpApp(meta: PengineMetadata) {
		let out = `% app = ${this.id}, id = ${this.state.id.toString()}\n`;
		out += meta.src_text ? meta.src_text + "\n" : "";
		out += this.dumpModule(this.pl.session.modules.app);
		return out;
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
		const resp = await this.meta.get() ?? {};
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
		console.log("EXEC~~", query);
		for await (const [goal, answer] of answers) {
			console.log("EXEC", goal, answer, request);
			if (answer.indicator == "throw/1") {
				console.error(this.pl.session.format_answer(answer));
			}
		}
		await this.save();
		// return new Response("true.\n");
		const meta = await this.meta.get() ?? {src_urls: [], title: "untitled"};
		return prologResponse(this.dumpApp(meta));
	}

	async handleDump(request: Request): Promise<Response> {
		const meta = await this.meta.get() ?? {src_urls: [], title: "untitled"};
		return prologResponse(this.dumpApp(meta));
	}

	async handleSession(websocket) {
		websocket.accept();
		websocket.addEventListener("message", async (msg) => {
			console.log("websocket msg", msg);
			// if (data === "CLICK") {
			// 	count += 1;
			// 	websocket.send(JSON.stringify({ count, tz: new Date() }));
			// } else {
			// 	// An unknown message came into the server. Send back an error message
			// 	websocket.send(JSON.stringify({ error: "Unknown message received", tz: new Date() }));
			// }
		});

		websocket.addEventListener("close", async evt => {
			// Handle when a client closes the WebSocket connection
			console.log("wsclose", evt);
		});
	}

	async handleWebsocket(request: Request) {
		const upgradeHeader = request.headers.get("Upgrade");
		if (upgradeHeader !== "websocket") {
			return new Response("Expected websocket", { status: 400 });
		}

		const [client, server] = Object.values(new WebSocketPair());
		await this.handleSession(server);

		return new Response(null, {
			status: 101,
			webSocket: client
		});
	}
}