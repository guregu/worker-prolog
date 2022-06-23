import { HTMLResponse } from "@worker-tools/html";
import pl from "tau-prolog";
import { Env } from ".";
import { functor, makeError, newStream, Prolog, Query } from "./prolog";
import { Store } from "./unholy";
import { renderOutput } from "./views/result";

const TX_CHUNK_SIZE = 25;

export interface TXMeta {
	id: string;
	txid: number;
	time: number;
}

export class PrologDO {
	state: DurableObjectState;
	env: Env;
	id!: string;

	// in-memory:
	// prolog interpreter
	pl!: Prolog;
	// transaction ID (counter)
	txid: number = 0;
	lastmod: number = 0;
	dirty = false;
	// packages linked to other DO's state
	links: Record<string, DurableObjectStub> = {}; // module → ApplicationDO stub

	// persistence:
	// prolog-format dump of all predicates (record: module → program)
	prog: Store<string>;
	// tx state
	txmeta: Store<TXMeta>;

	sockets: Map<string, WebSocket> = new Map(); // socket ID → WebSocket
	onmessage?: (id: string, from: string, msg: any) => void;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
		this.prog = new Store(this.state.storage, "prog", {});
		this.txmeta = new Store(this.state.storage, "tx", {});
		this.state.blockConcurrencyWhile(async () => {
			const tx = await this.txmeta.get();
			this.id = tx ? tx.id : "";
			this.txid = tx ? tx.txid : 0;
			this.lastmod = tx?.time ? tx.time : 0;
			this.pl = await this.load();
		});	  
	}

	setID(id: string) {
		switch (this.id) {
		case id:
			return;
		case undefined:
		case "":
			this.id = id;
			return;
		}
		throw new Error(`mismatched IDs. this = ${this.id}, new = ${id}`);
	}

	async load(): Promise<Prolog> {
		const prolog = new Prolog(undefined, this);

		const prog = await this.prog.record(); // Record<module, program>
		for (const [_modID, text] of Object.entries(prog)) {
			// console.log("[LOAD]", modID, "text: ===\n", text);
			prolog.session.consult(text, {
				session: prolog.session,
				reconsult: true,
			})
		}

		const notify = (text: string) => {
			if (text == "") {
				return;
			}
			(new HTMLResponse(renderOutput(text))).text().then((html) => {
				this.broadcast("stdout:" + html);
			});
		};
		prolog.session.streams["stdout"] = newStream("stdout", undefined, (buf: string) => {
			notify(buf);
			return true; // clear buffer
		});
		prolog.session.standard_output = prolog.session.streams["stdout"];
		prolog.session.set_current_output(prolog.session.streams["stdout"]);

		return prolog;
	}

	async save(exclude?: string[]) {
		if (!this.dirty) {
			console.log("skip save: not dirty");
			return;
		}

		// this.state.blockConcurrencyWhile(async () => {
			const txid = ++this.txid;
			this.dirty = false;
			this.lastmod = Date.now();
			const progs = this.dumpLocal(exclude);
			await Promise.all([
				this.prog.putRecord(`tx${txid}`, progs),
				this.txmeta.put({
					id: this.id,
					txid: txid,
					time: this.lastmod,
				})
			]);
			this.dirty = false;
		// })
	}

	dump(): string {
		let prog = "";
		for (const mod of Object.values(this.pl.session.modules) as pl.type.Module[]) {
			if (mod.is_library) {
				continue;
			}
			prog += this.dumpModule(mod);
		}
		return prog;
	}

	dumpLocal(exclude?: string[]): Record<string, string> {
		const progs: Record<string, string> = {};
		for (const mod of Object.values(this.pl.session.modules) as pl.type.Module[]) {
			if (mod.is_library) {
				continue;
			}
			if (exclude && exclude.includes(mod.id)) {
				continue;
			}
			if (this.links[mod.id]) {
				continue;
			}
			progs[mod.id] = this.dumpModule(mod);
		}
		return progs;
	}

	dumpAll(): Record<string, string> {
		const progs: Record<string, string> = {};
		for (const mod of Object.values(this.pl.session.modules) as pl.type.Module[]) {
			if (mod.is_library) {
				continue;
			}
			progs[mod.id] = this.dumpModule(mod);
		}
		return progs;
	}

	dumpModule(mod: pl.type.Module, name?: string) {
		if (!mod || !mod.rules) {
			return "";
		}
		if (!name) {
			name = mod.id;
		}

		// const moduleTerm = new pl.type.Term(name, []);

		let prog = `%%% ${mod.id} as ${name}\n`;
		prog += `:- module(${name}, [${Object.keys(mod.rules).join(",")}]).\n`
		
		// // TODO: broken?
		// for (const dep of mod.dependencies) {
		// 	if (dep == "system") { continue; }
		// 	prog += `:- use_module(library(${dep})).\n`;
		// }
		prog += `:- use_module(library(lists)).\n:- use_module(library(js)).\n:- use_module(library(random)).\n:- use_module(library(format)).\n:- use_module(library(charsio)).\n\n`;


		for (const [pi, rs] of Object.entries(mod.rules) as [string, pl.type.Rule[]][]) {
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

	async run(prog: string | pl.type.State[], chunk?: number, throws = false): Promise<[Query, [pl.type.Term<number, string>, pl.type.Substitution][]]> {
		const query = new Query(this.pl.session, prog);
		const answers = query.answer();
		const results: [pl.type.Term<number, string>, pl.type.Substitution][] = [];
		for await (const [goal, answer] of answers) {
			if (pl.type.is_term(answer)) {
				console.error(this.pl.session.format_answer(answer));
				if (throws) {
					throw answer;
				}
				continue;
			}
			
			results.push([goal, answer as pl.type.Substitution]);
			if (chunk && results.length == chunk) {
				break;
			}
		}
		const tx = query.tx();
		if (tx) {
			this.dirty = true;
			await this.transact(tx)
		}
		await this.save();
		return [query, results];
	}

	async replicate(tx: string, module?: string) {
		const ops = tx.split(".\n");
		for (let prog of ops) {
			if (prog.endsWith(".")) {
				prog = prog.slice(0, prog.length-1);
			}
			// `[Op, user:X] =.. (assertz(user:foo(bar)))`
			const query = new Query(this.pl.session, `Prog = (${prog}), ( Prog =.. [Op, user:X] -> call(Op, ${module}:X) ; call(Prog) ).`);
			query.drain();
		}
		this.dirty = true;
		await this.save();
	}

	async transact(tx: pl.type.Term<number, string>[]) {
		const modTX: Record<string, pl.type.Term<number, string>[]> = {};
		for (let op of tx) {
			let modID = "user";
			if (pl.type.is_term(op.args[0])) {
				if (op.args[0].indicator === ":/2") {
					const mod = (op.args[0] as pl.type.Term<2, ":">).args[0];
					if (pl.type.is_atom(mod)) {
						modID = mod.id;
						// transform: foo:bar(baz) → bar(baz).
						op.args[0] = op.args[0].args[1];
					}
				}
			}
			if (modTX[modID]) {
				modTX[modID].push(op);
			} else {
				modTX[modID] = [op];
			}
		}

		for (const [mod, tx] of Object.entries(modTX)) {
			const link = this.links[mod];
			if (!link) {
				// local module
				continue;
			}

			// TODO: same DO?
			const txQuery = tx.map(t => t.toString({session: this.pl.session, quoted: true, ignore_ops: true})).join(".\n") + ".";
			// console.log(`📧 -> ${mod}: ${txQuery}`);
			const update = new Request(`http://${mod}/tx?rename=${mod}`, {
				method: "POST",
				body: txQuery,
				headers: {
					"Pengine": this.state.id.toString(),
				},
			});
			const result = await link.fetch(update);
			if (!result.ok) {
				throw `"TX FAILED: ${await result.text()}"`;
			}
			switch (result.status) {
			case 200:
				const src = await result.text();
				console.log("aftersrc", src);
				await this._consultApp(mod, src);
				break;
			case 206:
				this.broadcast(`tx:${txQuery}`);
				break;
			default:
				console.warn("unhandled result status:", result.status, result);
			}
		}
	}

	// tx web handler
	async handleTx(request: Request): Promise<Response> {
		// const url = new URL(request.url);
		// const name = url.searchParams.get("rename") ?? undefined;
		const pengine = request.headers.get("Pengine") ?? undefined;

		const prog = await request.text();
		const tx = prog.split("\n");

		let changes: pl.type.Term<number, string>[] = [];
		const flush = () => {
			if (changes.length == 0) {
				return;
			}
			if (changes.length > 0) {
				const update = changes.map(
					(x) => x.toString({session: this.pl.session, quoted: true, ignore_ops: false})
				).join(".\n ") + ".";
				this.broadcast(update, pengine);
				changes = [];
			}
		}

		for (const op of tx) {
			const query = new Query(this.pl.session, op);
			const answers = query.answer();
			for await (const [goal, answer] of answers) {
				if (pl.type.is_error(answer)) {
					console.error(this.pl.session.format_answer(answer));
					continue;
				}
				changes.push(goal);
				if (changes.length === TX_CHUNK_SIZE) {
					flush();
				}
			}
		}
		this.dirty = true;
		await this.save();
		flush();

		return new Response(null, {status: 206});

		// TODO: other/all modules?
		// return prologResponse(this.dumpModule(this.pl.session.modules.user, name));
	}

	async linkApp(appID: string): Promise<pl.type.Module | undefined> {
		if (this.links[appID] && this.pl.session.modules[appID]) {
			this.gossip(appID);
			return this.pl.session.modules[appID];
		}
		// TODO: not just app DO
		const link = this.env.PENGINES_APP_DO.get(this.env.PENGINES_APP_DO.idFromName(appID));
		this.links[appID] = link;
		this.gossip(appID);
		return await this.syncForeignModule(appID);
	}

	async gossip(appID: string) {
		let socket = this.sockets.get(appID);

		console.log("RDY?", socket, socket?.readyState);
		if (socket?.readyState === 1) {
			return;
		}

		const stub = this.links[appID];
		const resp = await stub.fetch(`http://${appID}/${this.state.id.toString()}?rename=${appID}`, {
			headers: {
				Upgrade: "websocket",
			},
		});

		socket = resp.webSocket;
		if (!socket) {
			throw new Error("server didn't accept WebSocket");
		}
		socket.accept();
		console.log("[gossip] connected to websocket", socket, appID);

		socket.addEventListener("message", (msg: MessageEvent) => {
			let promise;
			if (msg.data === "true.") {
				promise = this.syncForeignModule(appID)
			} else {
				const tx = msg.data;
				// console.log("gossip tx:", tx);
				promise = this.replicate(tx, appID);
			}
			promise.then(() => {
				this.broadcast(`update:${msg.data}`);
			});
		});

		this.sockets.set(appID, socket);
	}

	async syncForeignModule(appID: string) {
		const link = this.links[appID];
		console.log("syncing app2...", appID);
		const update = new Request(`http://${appID}/dump.pl?rename=${appID}`);
		const result = await link.fetch(update);
		const prog = await result.text();
		if (!result.ok) {
			throw makeError("consult_app_error", result.status);
		}
		// console.log("app prog for", appID, "::", prog);
		return await this._consultApp(appID, prog);
	}

	private async _consultApp(appID: string, prog: string) {
		this.dirty = true;
		await this.pl.consult(prog, {
			session: this.pl.session,
			from: "app_" + appID,
			reconsult: true,
			url: false,
			html: false,
			error: function(err: unknown) {
				console.error("invalid app text:", prog);
				throw makeError("consult_error", err, functor("application", appID));
			}
		});
		return this.pl.session.modules[appID];
	}

	async handleSession(id: string, websocket: WebSocket, from: string) {
		websocket.accept();
		this.sockets.set(from, websocket);
		websocket.addEventListener("message", (msg) => {
			if (this.onmessage) {
				this.onmessage(id, from, msg.data);
			}
		});

		websocket.addEventListener("close", (evt) => {
			this.sockets.delete(from);
		});
	}

	async handleWebsocket(id: string, request: Request, fromID?: string) {
		const upgradeHeader = request.headers.get("Upgrade");
		if (upgradeHeader !== "websocket") {
			return new Response("Expected websocket", { status: 400 });
		}

		const url = new URL(request.url);
		const from = fromID ?? url.pathname.slice(1);
		const [client, server] = Object.values(new WebSocketPair());
		await this.handleSession(id, server as unknown as WebSocket, from);

		return new Response(null, {
			status: 101,
			webSocket: client
		});
	}

	broadcast(msg: string, exclude?: string) {
		for (const [id, socket] of this.sockets) {
			if (exclude && id == exclude) {
				continue;
			}
			// console.log("broadcast to", id, "->", msg);
			socket.send(msg);
		}
	}
}

export function dumpModule(mod: pl.type.Module): string {
	if (!mod || !mod.rules) {
		return "";
	}

	let prog = "";
	// const moduleTerm = new pl.type.Term(name, []);
	for (const [pi, rs] of Object.entries(mod.rules) as [string, pl.type.Rule[]][]) {
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
			prog += rule.toString({quoted: true}) + "\n";
		}
	}
	return prog;
}

declare global {
	interface WebSocket {
		accept(): void;
	}
	interface Response {
		webSocket?: WebSocket;
	}
}
// interface WebSocket {
// 	send(msg: string): void;
// 	accept(): void;
// 	addEventListener(a: string, f: (msg: MessageEvent) => void): void;
// 	readonly readyState: number;
// }
