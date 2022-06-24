import pl from "tau-prolog";
import { JSONResponse } from "@worker-tools/json-fetch";
import { functor, makeError } from "./prolog";
import { PrologDO } from "./prolog-do";
import { PengineMetadata } from "./pengines";
import { Store } from "./unholy";
import { prologResponse } from "./response";

export interface Application {
	id: string,
	meta: PengineMetadata,
	txid: number,
	listeners: string[];
	dump?: Record<string, string>;
	compiled: string;
}

export class ApplicationDO extends PrologDO {
	meta: Store<PengineMetadata>;
	
	constructor(state: DurableObjectState, env: never) {
		super(state, env);
		this.meta = new Store(this.state.storage, "meta", pl.type);
		this.meta.get().then((meta?: PengineMetadata) => {
			if (meta?.application) {
				this.setID(meta?.application);
			}
		});
	}

	async fetch(request: Request) {
		const url = new URL(request.url);
		this.setID(url.searchParams.get("application") ?? url.hostname)

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

		if (req.src_urls.length > 0 || req.src_text) {
			this.pl.resetRules();
		}

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
			// wipe all static predicates, otherwise it's impossible to delete them
			await this.pl.consult(req.src_text, {
				session: this.pl.session,
				reconsult: true,
				url: false,
				html: false,
				success: () => {
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

		await Promise.all([
			this.meta.put(req),
			this.save(),
		]);

		this.broadcast("true.");
		return new JSONResponse(await this.info());
	}

	main() {
		return this.pl.session.modules[this.id] ?? this.pl.session.modules.user;
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
			txid: this.txid,
			listeners: Array.from(this.sockets.keys()),
			dump: this.dumpAll(),
			compiled: this.compile(),
		};
	}

	async handleIndex(_request: Request): Promise<Response> {
		return new JSONResponse(await this.info());
	}

	async handleMeta(_request: Request): Promise<Response> {
		const resp = await this.getMeta();
		resp.listeners = Array.from(this.sockets.keys());
		return new JSONResponse(resp);
	}

	async handleDump(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const modID = url.searchParams.get("module");
		const mod = modID ? this.pl.session.modules[modID] : this.main();
		const rename = url.searchParams.get("rename") ?? "app";
		return prologResponse(this.dumpModule(mod, rename));
	}
}