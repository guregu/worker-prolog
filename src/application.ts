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
	listeners: string[];
	dump?: string;
}

interface WebSocket {
	send(msg: string): void;
	accept(): void;
	addEventListener(a: string, f: (msg: MessageEvent) => void): void;
}

export class ApplicationDO extends PrologDO {
	id: string | undefined;
	meta: Store<PengineMetadata>;
	
	constructor(state: DurableObjectState, env: never) {
		super(state, env);
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

		if (request.headers.get("Upgrade") == "websocket") {
			return this.handleWebsocket(this.id, request);
		}
		
		switch (url.pathname) {
		case "/":
			return this.handleIndex(request);
		case "/tx":
			return this.handleTx(request);
		case "/set":
			return this.handleSet(request);
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
		this.dirty = true;
		await this.meta.put(req);

		for (const url of req.src_urls) {
			const resp = await fetch(new Request(url));
			if (resp.status != 200) {
				throw makeError("consult_error", functor("bad_status", resp.status), url);
			}
			const prog = await resp.text();

			console.log("consulted url", url, prog.slice(0, 64));
			await this.pl.consult(prog, {
				session: this.pl.session,
				// context_module: "app",
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
			await this.pl.consult(req.src_text, {
				session: this.pl.session,
				context_module: "user",
				// context_module: "app",
				reconsult: true,
				url: false,
				html: false,
				success: () => {
					console.log("consulted text:", req.src_text);
					for (const warning of this.pl.session.get_warnings()) {
						console.error(warning);
					}
				},
				error: function(err: unknown) {
					console.error("invalid src_text:", req.src_text);
					throw makeError("consult_error", err, "src_text");
				}
			});
		}

		await this.save();

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
			listeners: Array.from(this.sockets.keys()),
			dump: this.dumpApp(meta),
		};
	}

	dumpApp(meta: PengineMetadata): string {
		let out = `% app = ${this.id}, id = ${this.state.id.toString()}\n`;
		// out += meta.src_text ? meta.src_text + "\n" : "";
		out += this.dumpModule(this.pl.session.modules.user, "app");
		return out;
	}

	async handleIndex(_request: Request): Promise<Response> {
		return makeResponse(await this.info());
	}

	async handleMeta(_request: Request): Promise<Response> {
		const resp = await this.getMeta();
		resp.listeners = Array.from(this.sockets.keys());
		return new JSONResponse(resp);
	}

	async handleDump(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const mod = url.searchParams.get("module") ?? "user";
		const rename = url.searchParams.get("rename") ?? "app";
		const meta = await this.getMeta();
		return prologResponse(this.dumpModule(this.pl.session.modules[mod], rename));
	}
}