import { html, HTML, unsafeHTML } from "@worker-tools/html";
import { PengineRequest } from "../pengines";
import { indexStyle } from "../style";

export interface Pengine {
	id: string,
	ask?: string,
	query?: PengineRequest,
}

export function renderPengine(p: Pengine): HTML {
	return html`<main>
		${p.id};
		${p.ask};
		${p.query};
	</main>`;
}