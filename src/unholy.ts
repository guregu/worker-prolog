const CURRENT_VERSION = 11;
const PROTO_KEY = "$$proto";

export class Store<T> {
	storage: DurableObjectStorage;
	key: string;
	reviver: (k: string, v: any) => any | undefined;

	public constructor(storage: DurableObjectStorage, key: string, types: Record<string, any>) {
		this.storage = storage;
		this.key = key;
		this.reviver = makeReviver(types);
	}

	public async get(): Promise<T | undefined> {
		const raw = await this.storage.get(this.path());
		if (raw === undefined) {
			return undefined;
		}
		if (typeof raw !== "string") {
			throw(`unexpected value in get: ${raw}`);
		}
		return JSON.parse(raw, this.reviver);
	}

	public async record(prefix?: string): Promise<Record<string, T>> {
		const suffix = prefix ? prefix+":" : "";
		const path = `${this.path()}::${suffix}`;
		const items = await this.storage.list({
			prefix: path,
		});
		const record: Record<string, T> = {};
		let buf: string | null = null;
		let wip: string | null = null;
		for (let [k, raw] of items.entries()) {
			if (typeof raw !== "string") {
				throw(`unexpected value in record: ${raw}`);
			}
			const hash = k.indexOf("#");
			const n = Number(k.slice(hash+1));
			if (hash !== -1) {
				const root = k.slice(0, hash);
				if (raw == EOF) {
					raw = buf;
					buf = null;
					wip = null;
				} else {
					if (wip && root != wip) {
						console.warn("stray:", k, raw, "wip:", wip);
						continue;
					}
					if (n == 0) {
						wip = root;
					}
					if (buf) {
						buf += raw;
					} else {
						buf = raw;
					}
					continue;
				}
			}
			try {
				const v = JSON.parse(raw as string, this.reviver);
				record[k.slice(path.length)] = v;
			} catch (ex) {
				console.warn("failed to parse json:", path, ex);
			}
		}
		return record;
	}

	public async put(v: T): Promise<void> {
		const path = this.path();
		const enc = this.encode(v);
		return this.storage.put(path, enc);
	}

	public async putRecord(prefix: string, record: Record<string, T>) {
		const puts = [];
		for (const [key, value] of Object.entries(record)) {
			const path = this.recordPath(prefix, key);
			const chunks = this.chunk(path, value)
			puts.push(this.multiput(chunks));
		}
		return Promise.all(puts);
	}

	public async putRecordItem(prefix: string, key: string, value: T) {
		const path = this.recordPath(prefix, key);
		const chunks = this.chunk(path, value)
		return this.multiput(chunks);
	}

	public async delete(): Promise<boolean> {
		return this.storage.delete(this.path());
	}

	private encode(value: T): string {
		return JSON.stringify(value, replacer);
	}

	private multiput(chunks: Record<string, string>) {
		for (const [k, v] of Object.entries(chunks)) {
			this.storage.put(k, v);
		}
		// return this.storage.put(chunks);
	}

	private chunk(key: string, value: T): Record<string, string> {
		const size = (CF_MAXSIZE-key.length-1)/2; // 2-byte per character
		const str = JSON.stringify(value, replacer);
		// if (str.length < size) {
		// 	return {[key]: str};
		// }


		let testCheck = "";

		const obj: Record<string, string> = {};
		let i = 0;
		for (let pos = 0; pos < str.length; pos += size) {
			const chunk = str.slice(pos, pos+size);
			obj[`${key}#${i}`] = chunk;
			i++;
		}

		obj[`${key}#${i}`] = EOF;
		console.table(obj);
		return obj;
	}

	private path(): string {
		return `${this.key}:v${CURRENT_VERSION}`;
	}

	private recordPath(prefix = "", key = ""): string {
		return `${this.path()}::${prefix}:${key}`;
	}
}

export function replacer(k, v): any {
	if (Array.isArray(v)) {
		return v.map(function(x, y) { return replacer(y, x); });
	}
	if (typeof v == "object" && v != null) {
		const proto = Object.getPrototypeOf(v);
		const name = proto.constructor.name;
		if (name === "Object") {
			return v;
		}
		if (proto) {
			return {...v, [PROTO_KEY]: name};
		}
	}
	return v;
}

const EOF = "\0x1E" // File Separator
const CF_MAXSIZE = 131072;

export function makeReviver(types: Record<string, any> = globalThis) {
	return function(k, v) {
		if (typeof v !== "object" || v == null) {
			return v;
		}
		if (typeof v[PROTO_KEY] !== "string") {
			return v;
		}
		const proto = types[v[PROTO_KEY]];
		if (!proto || !proto?.prototype) {
			return v;
		}
		delete v[PROTO_KEY];
		Object.setPrototypeOf(v, proto.prototype);
		return v;
	};
}

export async function parseResponse(resp: Response, types: Record<string, any> = globalThis): Promise<any> {
	const reviver = makeReviver(types);
	const text = await resp.text();
	return JSON.parse(text, reviver);
}

export function makeResponse(obj: any): Response {
	const text = JSON.stringify(obj, replacer);
	return new Response(text, {
		headers: {
			"Content-Type": "application/json; charset=UTF-8"
		}
	});
}