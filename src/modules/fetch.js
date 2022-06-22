// @ts-nocheck

// fetchModule is a hacked verison of the js module from tau-prolog.
// replaces XMLHttpRequest with fetch.

/*

BSD 3-Clause License

Copyright (c) 2017-2020, José Antonio Riaza Valverde
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

*/

export function fetchModule(pl) {
	pl.modules.js.rules["ajax/4"] = function( thread, point, atom ) {
		var method = atom.args[0], url = atom.args[1], value = atom.args[2], options = atom.args[3];
		if(pl.type.is_variable(url) || pl.type.is_variable(method) || pl.type.is_variable(options)) {
			thread.throw_error( pl.error.instantiation( atom.indicator ) );
		} else if(!pl.type.is_atom(url)) {
			thread.throw_error( pl.error.type( "atom", url, atom.indicator ) );
		} else if(!pl.type.is_atom(method)) {
			thread.throw_error( pl.error.type( "atom", method, atom.indicator ) );
		} else if(!pl.type.is_list(options)) {
			thread.throw_error( pl.error.type( "list", options, atom.indicator ) );
		} else if(["connect", "delete", "get", "head", "options", "patch", "post", "put", "trace"].indexOf(method.id) === -1) {
			thread.throw_error( pl.error.domain( "http_method", method, atom.indicator ) );
		} else {
			var pointer = options;
			// TODO: support opt_type
			var opt_type = null;
			// var opt_timeout = 0;
			// var opt_credentials = "false";
			// var opt_async = "true";
			// var opt_mime = null;
			var opt_headers = [];
			var opt_body = new FormData();
			var opt_user = null;
			var opt_password = null;
			// Options
			while(pl.type.is_term(pointer) && pointer.indicator === "./2") {
				var option = pointer.args[0];
				if(!pl.type.is_term(option) || option.args.length !== 1) {
					thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
					return;
				}
				var prop = option.args[0];
				// type/1
				if(option.indicator === "type/1") {
					if(!pl.type.is_atom(prop) || prop.id !== "text" && prop.id !== "json" && prop.id !== "document") {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					opt_type = prop.id;
				// user/1
				} else if(option.indicator === "user/1") {
					if(!pl.type.is_atom(prop)) {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					opt_user = prop.id;
				// password/1
				} else if(option.indicator === "password/1") {
					if(!pl.type.is_atom(prop)) {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					opt_password = prop.id;
				// timeout/1
				} else if(option.indicator === "timeout/1") {
					if(!pl.type.is_integer(prop) || prop.value < 0) {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					opt_timeout = prop.value;
				// async/1
				} else if(option.indicator === "async/1") {
					if(!pl.type.is_atom(prop) || prop.id !== "true" && prop.id !== "false") {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					opt_async = prop.id;
				// credentials/1
				} else if(option.indicator === "credentials/1") {
					if(!pl.type.is_atom(prop) || prop.id !== "true" && prop.id !== "false") {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					opt_credentials = prop.id;
				// mime/1
				} else if(option.indicator === "mime/1") {
					if(!pl.type.is_atom(prop)) {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					opt_mime = prop.id;
				// headers/1
				} else if(option.indicator === "headers/1") {
					if(!pl.type.is_list(prop)) {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					var hpointer = prop;
					while(pl.type.is_term(hpointer) && hpointer.indicator === "./2") {
						var header = hpointer.args[0];
						if(!pl.type.is_term(header) || header.indicator !== "-/2" || !pl.type.is_atom(header.args[0]) || !pl.type.is_atom(header.args[1])) {
							thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
							return;
						}
						opt_headers.push({header: header.args[0].id, value: header.args[1].id});
						hpointer = hpointer.args[1];
					}
					if(pl.type.is_variable(hpointer)) {
						thread.throw_error( pl.error.instantiation( atom.indicator ) );
						return;
					} else if(!pl.type.is_term(hpointer) || hpointer.indicator !== "[]/0") {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
				// body/1
				} else if(option.indicator === "body/1") {
					if(!pl.type.is_list(prop) && (pl.type.is_dom_object === undefined || !pl.type.is_dom_object(prop)) && !pl.type.is_atom(prop)) {
						thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
						return;
					}
					if(pl.type.is_list(prop)) {
						var hpointer = prop;
						while(pl.type.is_term(hpointer) && hpointer.indicator === "./2") {
							var body = hpointer.args[0];
							if(!pl.type.is_term(body) || body.indicator !== "-/2" || !pl.type.is_atom(body.args[0]) || !pl.type.is_atom(body.args[1])) {
								thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
								return;
							}
							opt_body.append(body.args[0].id, body.args[1].id);
							hpointer = hpointer.args[1];
						}
						if(pl.type.is_variable(hpointer)) {
							thread.throw_error( pl.error.instantiation( atom.indicator ) );
							return;
						} else if(!pl.type.is_term(hpointer) || hpointer.indicator !== "[]/0") {
							thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
							return;
						}
					} else if(pl.type.is_atom(prop)) {
						opt_body = prop.id;
					} else {
						opt_body = prop.value;
					}
				// otherwise
				} else {
					thread.throw_error( pl.error.domain( "ajax_option", option, atom.indicator ) );
					return;
				}
				pointer = pointer.args[1];
			}
			if(pl.type.is_variable(pointer)) {
				thread.throw_error( pl.error.instantiation( atom.indicator ) );
				return;
			} else if(!pl.type.is_term(pointer) || pointer.indicator !== "[]/0") {
				thread.throw_error( pl.error.type( "list", options, atom.indicator ) );
				return;
			}

			// Request			
			const headers = new Headers();
			if (opt_user && opt_password) {
				headers.set('Authorization', 'Basic ' + atob(opt_user + ":" + opt_password));
			}
			for (const hdr of opt_headers) {
				headers.set(hdr.header, hdr.value);
			}
			fetch(new Request(url.id, {
				method: method.id.toUpperCase(),
			})).then(async (resp) => {
				if (!resp.ok) {
					// TODO: ?
					throw(resp.status)
					return;
				}

				let term;
				if (resp.headers.get("Content-Type")?.includes("application/json")) {
					term = pl.fromJavaScript.apply(await resp.json());
				} else {
					// TODO: DOM
					term = new pl.type.Type(await resp.text(), []);
				}
				console.log("fetched", url.id, term);
				thread.prepend([
					new pl.type.State(
						point.goal.replace(new pl.type.Term("=", [value, term])),
						point.substitution,
						point
					)
				]);
				thread.again();
			});
			return true;
		}
	}
}