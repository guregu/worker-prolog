import pl from "tau-prolog";
import { JSONResponse } from "@worker-tools/json-fetch";
import { functor, makeError, Query } from "./prolog";
import { PrologDO } from "./prolog-do";
import { PengineMetadata } from "./pengines";
import { makeResponse, Store } from "./unholy";
import { prologResponse } from "./response";

export interface Application {
	id: string,
	meta: PengineMetadata,
	modules: Record<string, Record<string, pl.type.Rule[]>>;
	listeners: string[];
	dump?: string;
}

interface WebSocket {
	send(msg: string): void;
	accept(): void;
	addEventListener(a: string, f: (msg: MessageEvent) => void): void;
}

export class ApplicationDO extends PrologDO {
	env: any;
	id: string | undefined;
	meta: Store<PengineMetadata>;

	constructor(state: DurableObjectState, env: never) {
		super(state, env);
		this.env = env;
		this.meta = new Store(this.state.storage, "meta", pl.type);
		this.meta.get().then((meta?: PengineMetadata) => {
			this.id = meta?.application;
		});
	}

	async fetch(request: Request) {
		const url = new URL(request.url);

		if (!this.id) {
			this.id = url.searchParams.get("application") ?? url.hostname;
		}
		this.debugdump();

		if (request.headers.get("Upgrade") == "websocket") {
			return this.handleWebsocket(this.id, request);
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

		if (!this.pl.session.modules.app) {
			this.pl.session.modules.app = new pl.type.Module("app", {}, "all", {
				session: this.pl.session,
				dependencies: ["system"]
			});
		}

		for (const url of req.src_urls) {
			const resp = await fetch(new Request(url));
			if (resp.status != 200) {
				throw makeError("consult_error", functor("bad_status", resp.status), url);
			}
			const prog = await resp.text();

			console.log("consulted url", url, prog.slice(0, 64));
			this.pl.session.consult(prog, {
				context_module: "app",
				reconsult: true,
				url: false,
				html: false,
				success: function() {
					console.log("consulted url:", url, prog.length);
				}.bind(this),
				error: function(err: unknown) {
					console.error("invalid src_url text:", prog);
					throw makeError("consult_error", err, functor("src_url", url));
				}
			});
		}

		if (req.src_text) {
			this.pl.session.consult(req.src_text, {
				context_module: "app",
				reconsult: true,
				url: false,
				html: false,
				success: function() {
					console.log("consulted text:", req.src_text);
				},
				error: function(err: unknown) {
					console.error("invalid src_text:", req.src_text);
					throw makeError("consult_error", err, "src_text");
				}
			});
		}

		this.broadcast("true.");
		return makeResponse(await this.info());
	}

	async getMeta(): Promise<PengineMetadata> {
		return await this.meta.get() ?? {
			application: this.id,
			title: "untitled",
			src_urls: [],
		};
	}

	async info(): Promise<Application> {
		const meta = await this.getMeta();
		return {
			id: this.id!,
			meta: meta,
			modules: this.modules(),
			listeners: Array.from(this.sockets.keys()),
			dump: this.dumpApp(meta)
		};
	}

	dumpApp(meta: PengineMetadata): string {
		let out = `% app = ${this.id}, id = ${this.state.id.toString()}\n`;
		// out += meta.src_text ? meta.src_text + "\n" : "";
		out += this.dumpModule(this.pl.session.modules.app);
		return out;
	}

	modules() {
		const mods: Record<string, Partial<pl.type.Module>> = {};
		for (const [name, mod] of Object.entries<pl.type.Module>(this.pl.session.modules)) {
			if (mod.is_library) {
				continue;
			}
			mods[name] = {
				rules: mod.rules,
			};
		}
		return mods;
	}

	async handleIndex(_request: Request): Promise<Response> {
		return makeResponse(await this.info());
	}

	async handleMeta(_request: Request): Promise<Response> {
		const resp = await this.getMeta();
		resp.listeners = Array.from(this.sockets.keys());
		return new JSONResponse(resp);
	}

	async handleRules(_request: Request): Promise<Response> {
		const mods = this.pl.session.modules;
		return makeResponse(mods);
	}

	async handleExec(request: Request): Promise<Response> {
		const prog = await request.text();
		const pengine = request.headers.get("Pengine") ?? undefined;
		const query = new Query(this.pl.session, prog);
		const answers = query.answer();
		const changes = [];
		for await (const [goal, answer] of answers) {
			if (answer.indicator == "throw/1") {
				console.error(this.pl.session.format_answer(answer));
				continue;
			}
			changes.push(goal);
		}
		await this.save();

		if (changes.length > 0) {
			const update = changes
				.map(x => x.toString({session: this.pl.session, quoted: true, ignore_ops: false}))
				.join(", ") + ".";
			this.broadcast(update, pengine);
		}

		const meta = await this.getMeta();
		return prologResponse(this.dumpApp(meta));
	}

	async handleDump(_request: Request): Promise<Response> {
		const meta = await this.getMeta();
		return prologResponse(this.dumpApp(meta));
	}
}

export function compileApp(mod: pl.type.Module) {

}