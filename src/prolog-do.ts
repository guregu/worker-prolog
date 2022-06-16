import pl from "tau-prolog";
import { Prolog, Query } from "./prolog";
import { Store } from "./unholy";

export class PrologDO {
	state: DurableObjectState;
	pl!: Prolog;
	rules: Store<pl.type.Rule[]>;

	sockets: Map<string, WebSocket> = new Map();
	onmessage?: (id: string, from: string, msg: any) => void;

	constructor(state: DurableObjectState, env) {
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
		for (const [name, mod] of Object.entries(this.pl.session.modules) as [string, pl.type.Module][]) {
			if (mod.is_library) {
				continue;
			}
			console.log("savemod?", name, mod.rules);
			await this.rules.putRecord(name, mod.rules);
		}
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

	dumpModule(mod: pl.type.Module, name?: string) {
		if (!mod || !mod.rules) {
			return "";
		}
		if (!name) {
			name = mod.id;
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
				prog += rule.toString({session: this.pl.session, quoted: true}) + "\n";
			}
		}
		return prog;
	}

	async run(prog: string): Promise<[pl.type.Term, pl.type.Substitution][]> {
		const query = new Query(this.pl.session, prog);
		const answers = query.answer();
		const results: [pl.type.Term, pl.type.Substitution][] = [];
		for await (const [goal, answer] of answers) {
			if (answer.indicator == "throw/1") {
				console.error(this.pl.session.format_answer(answer));
				throw answer;
			}
			results.push([goal, answer]);
		}
		await this.save();
		return results;
	}

	async handleSession(id: string, websocket: WebSocket, from: string) {
		websocket.accept();
		this.sockets.set(from, websocket);
		websocket.addEventListener("message", async (msg) => {
			if (this.onmessage) {
				this.onmessage(id, from, msg.data);
			}
		});

		websocket.addEventListener("close", async (evt) => {
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
		console.log("broadcastin", this.sockets.size);
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