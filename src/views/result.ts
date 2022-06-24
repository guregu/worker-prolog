import { HTML, html } from "@worker-tools/html";
import { PengineResponse } from "../response";

export function renderResult(result: PengineResponse, omitOutput = false): HTML {
	const query_time = result?.time ?? result?.answer?.time ?? result?.data?.time;
	return html`
	<fieldset class="answer" data-ask="${result.ask}">
		<legend><span>${eventEmoji(result)} ${new Date().toLocaleTimeString()} ${(query_time && query_time > 0) ? html`<small>${query_time} seconds</small>` : null}</span></legend>
		<p class="ask"><a href="#src_text" onclick="return setAsk(decodeURIComponent('${encodeURIComponent(result.ask ?? '')}'));">${result.ask}</a></p>
		<blockquote class="output">${result?.output}</blockquote>
		${renderAnswersTable(result)}
	</fieldset>`;
}

export function renderOutput(text: string): HTML {
	return html`
	<fieldset class="answer">
		<legend><span>📢 ${new Date().toLocaleTimeString()}</span></legend>
		<blockquote class="output">${text}</blockquote>
	</fieldset>`;
}


export function renderDescription(result: PengineResponse): string {
	const emoji = eventEmoji(result);
	switch (result.event) {
	case "failure":
		return `${emoji} no`;
	case "error":
		return `${emoji} error: ${renderTermText(result?.data)}`;
	}

	let projection = result.projection ?? [];
	let data = result?.data;
	if (!data) {
		return "(empty)";
	}

	return data.map(function(x: Record<string, unknown>) {
		const entries = Object.entries(x);
		if (entries.length == 0) {
			return `${emoji} yes`;
		}
		return entries.map(function([k, v]) {
			if (!projection.includes(k)) { return null; }
			return `${k} = ${renderTermText(v)}`;
		}).join(", ");
	}).join(" ;\n") + ".";
}

function eventEmoji(result: PengineResponse): string {
	switch (result.event) {
	case "success":
		return "👍";
	case "failure":
		return "💡";
	case "error":
		return "😵";
	case "create":
		return "✨";
	case "destroy":
		return "💥";
	default:
		return "❓";
	}
}

function renderAnswersTable(result?: PengineResponse): HTML {
	if (!result) {
		return html``;
	}
	switch (result.event) {
	case "error":
		return html`
			<div>
				<b class="answer error">Error</b>: ${renderTerm(result.data)}
			</div>
		`;
	case "failure":
		return html`
			<div>
				<b class="answer false">no</b>
			</div>
		`;
	case "success":
		return html`
			<table>
				<thead>
					<tr>
						${result?.projection?.map(x => html`<th>${x}</th>`)}
					</tr>
				</thead>
				<tbody>
					${result?.data?.map((x: Record<string, unknown>) => renderAnswerTable(result?.projection!, x))}
				</tbody>
			</table>
		`;
	case "create":
		return html``;
	}

	return html`unknown event: ${result.event}`;
}

function renderAnswerTable(projection: string[], x: Record<string, any>): HTML {
	const entries = Object.entries(x);
	if (entries.length == 0) {
		return html`<b class="answer true">yes</b>&nbsp;`;
	}

	/* eslint-disable indent */
	return html`
		<tr>
			${entries.map(function([k, v]) {
				if (!projection.includes(k)) { return null; }
				return html`<td>${renderTerm(v)}</td>`;
			})}
		</tr>
	`;
	/* eslint-enable */
}

function renderTerm(x: any): HTML {
	// console.log("REnderTerm", x);
	switch (typeof x) {
	case "number":
		return html`${x}`;
	case "string":
		if ((x.startsWith("{") && x.endsWith("}")) || (x.startsWith("[") && x.endsWith("]"))) {
			try {
				const obj = JSON.parse(x);
				return html`<pre>${JSON.stringify(obj, null, 2)}</pre>`;
			} catch {
				//
			}
		}
		return html`${x}`;
	default:
		if (x == null) {
			return html`<i>null</i>`;
		}
		
		// lists
		if (Array.isArray(x)) {
			return html`[${x.map(function(v, i) {
				const result = renderTerm(v);
				if (i > 0) {
					return html`, ${result}`;
				}
				return html`${result}`;
			})}]`;
		}

		if (typeof x.pretty == "string") {
			return html`${x.pretty}`;
		}

		// compound
		if (typeof x.functor == "string") {
			return html`${x.functor}(${x.args.map(function(v: any, i: number) {
				const result = renderTerm(v);
				if (i > 0) {
					return html`, ${result}`;
				}
				return html`${result}`;
			})})`;
		}

		// hail mary
		return html`??? ${JSON.stringify(x)}`;
	}
}


function renderTermText(x: any): string {
	switch (typeof x) {
	case "number":
	case "string":
		return `${x}`;
	default:
		if (x == null) {
			return "null";
		}
		
		// lists
		if (Array.isArray(x)) {
			return `[${x.map(renderTermText).join(", ")}]`;
		}

		if (typeof x.pretty == "string") {
			return x.pretty;
		}

		// compound
		if (typeof x.functor == "string") {
			return `${x.functor}(${x.args.map(function(v: any, i: number) {
				const result = renderTermText(v);
				if (i > 0) {
					return `, ${result}`;
				}
				return `${result}`;
			})})`;
		}

		// hail mary
		return `??? ${x}`;
	}
}