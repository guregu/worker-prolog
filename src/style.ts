import { html}  from "@worker-tools/html";

export const indexStyle = html`
<style>
		html {
				color: #000;
				background: #fff;
				overflow-y: scroll;
				-webkit-text-size-adjust: 100%;
				-ms-text-size-adjust: 100%
		}

		html * {
				outline: 0;
				-webkit-text-size-adjust: none;
				-webkit-tap-highlight-color: rgba(0, 0, 0, 0)
		}

		body {
				margin: 0;
				font-family: sans-serif;
		}

		body > *:not(#query) {
				margin: 8px;
		}

		a, a:visited {
				color: black;
				text-decoration-thickness: from-font;
		}

		header h1 a, header h1 a:visited {
				text-decoration: none;
		}
		header h1 a:hover {
				text-decoration: underline;
		}

		.error {
				color: red;
		}

		#query {
				position: sticky;
				top: 0;
				background: #f7f7f7b3;
				backdrop-filter: blur(var(--frost-blur, 6px));
				-webkit-backdrop-filter: blur(var(--frost-blur, 6px));
				margin: 0;
				padding-left: 8px;
				padding-right: 8px;
		}

		#query form {
				padding-bottom: 0.5em;
				display: flex;
				align-items: center;
		}
		#query form > * {
				margin-top: 5px;
				margin-right: 5px;
		}
		#query form label[for=ask] {
				font-size: large;
				font-family: monospace;
		}
		#query form #ask {
				flex: 1;
		}


		#src_text {
				width: 80ch;
				height: 24ch;
				width: calc(100% - 8px);
		}

		section {
				margin: 0.3em;
		}

		details {
				border: 1px dotted lightgrey;
				max-width: 100%;
		}
		details.dump {
				overflow-y: auto;
		}
		details summary {
				background: #efefeb;
				padding: 0.3em;
				cursor: pointer;
		}
		details > *:not(summary) {
				margin: 0.3em;
		}

		details input {
			width: min(calc(100% - 8px), 80ch);
		}

		input, textarea {
				font-size: 16px;
				tab-size: 4;
		}

		table.form {
				width: 98%;
		}
		table.form td:first-of-type{
				width: 15ch;
		}

		.answer.false {
				color: crimson;
		}

		#results table {
				margin: 1px;
				border-collapse: collapse;
		}
		#results th, #results td {
				border: 1px solid lightgrey;
				padding: 0.3em;
		}
		#results th {
			background: #f4f4f4;
		}

		blockquote.output {
			background: #1b1a1a;
			color: white;
    		/* font-family: monospace; */
			font-size: medium;
			margin: 0.3em;
    		padding: 1em;
			white-space: pre;
			overflow: auto;
			word-break: keep-all;
			overflow-wrap: normal;
		}
		blockquote.output:empty {
			display: none;
		}

		footer {
				padding-top: 1em;
				text-align: center;
				color: #bdbdbd;
		}
		footer a, footer a:visited {
				color: #b5a7c9;
		}
</style>`;