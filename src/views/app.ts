import { html, HTML } from "@worker-tools/html";
import { favicon, indexStyle } from "./style";
import { Application } from "../application";
import { texteditJS } from "./scripts";
import { renderDump } from ".";

// TODO: work in progress for rendering "app data" for long-running Pengines
export function renderApplication(app: Application, params: URLSearchParams): HTML {
	const meta = app.meta;
	return html`<!doctype html>
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<html>
		<head>
			<title>prolog.run</title>
			${indexStyle}
			${favicon}
		</head>
		<body>
			<header>
				<h1><a href="/">𝖕𝖗𝖔𝖑𝖔𝖌.𝖗𝖚𝖓</a></h1>
				<h2>Application: ${meta?.application} <small>(#${app.txid})</small></h2>
			</header>

			<section id="meta">
				<label for="title">Title</label>: <input type="text" name="title" id="title" value="${meta.title}" form="app-form">
			</section>

			<section id="src">
				<div class="growtext">
					<div class="spacer" aria-hidden="true">${meta?.src_text}</div>
					<textarea id="src_text" name="src_text" form="app-form"
						class="${meta?.src_text && "loaded"}" spellcheck="false"
						placeholder="% Prolog code goes here">${meta?.src_text}</textarea>
				</div>
			</section>

			<section id="query">
				<form method="POST" id="app-form">
					<input type="hidden" name="id" value="${app.id}">
					<!--
					<label for="ask">?- </label>
					<input type="text" name="ask" id="ask"
						placeholder="member(X, [1, 2, 3])."
						list=examples>
					-->
					<input type="submit" value="Save">
				</form>
				<datalist id="examples"></datalist>
			</section>

			<br>

			${app.dump && renderDump(app.dump)}

			${app && app.listeners.length > 0 && html`
				<h3>Listeners</h3>
				<ul>
					${app.listeners.map(x => html`<li><a href="/id/${meta.application}:${x}">${x}</a></li>`)}
				</ul>
			`}

			${app && html`
					<details id="raw" class="dump">
						<summary>Raw result</summary>
						<code>${JSON.stringify(app)}</code>
					</details>`}
			
			<footer>
				<div class="fleuron">⬥ ❦ ⬥</div>
				<a href="https://github.com/guregu/worker-prolog" target="_blank">worker-prolog</a>
			</footer>
			${texteditJS}
		</body>
	</html>`;
}