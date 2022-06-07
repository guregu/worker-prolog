import { html, HTML } from "@worker-tools/html";
import { PengineRequest } from "../pengines";
import { favicon, indexStyle } from "./style";

export interface Pengine {
	id: string,
	src_text?: string,
	src_urls: string[],
	ask?: string,
	query?: PengineRequest,
}

// TODO: work in progress for rendering "app data" for long-running Pengines
export function renderPengine(meta: Pengine, params: URLSearchParams): HTML {
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
			</header>

			<section id="settings">
				<details>
					<summary>Advanced</summary>
					<table class="form">
						<tr>
							<td><label for="id">ID:</label></td>
							<td><input type="text" placeholder="(blank to randomly generate)" id="id" name="id" form="query-form" value="${meta?.id ?? params.get("id")}"></td>
						</tr>
						<tr>
							<td><label for="application">Application:</label></td>
							<td><input type="text" placeholder="pengine_sandbox" id="application" name="application" form="query-form" value="${params.get("application")}"></td>
						</tr>
						<tr>
							<td><label for="src_url">Source URL:</label></td>
							<td><input type="text" placeholder="https://example.com/test.pl" id="src_url" name="src_url" form="query-form" value="${params.get("src_url")}"></td>
						</tr>
					</table>						 
				</details>
			</section>

			<section id="src" class="growtext">
				<div class="spacer" aria-hidden="true">${meta?.src_text ?? params.get("src_text")}</div>
				<textarea id="src_text" name="src_text" form="query-form"
					class="${meta?.src_text && "loaded"}" spellcheck="false"
					placeholder="% Prolog code goes here">${meta?.src_text ?? params.get("src_text")}</textarea>
			</section>

			<section id="query">
				<form method="GET" id="query-form">
					<label for="ask">?- </label>
					<input type="text" name="ask" id="ask"
						value="${meta?.ask}"
						placeholder="member(X, [1, 2, 3])."
						list=examples>
					<input type="submit" value="Query">
				</form>
				<datalist id="examples"></datalist>
			</section>

			<br>
			
			<footer>
				<div class="fleuron">⬥ ❦ ⬥</div>
				<a href="https://github.com/guregu/worker-prolog" target="_blank">worker-prolog</a>
			</footer>
		</body>
	</html>`;
}