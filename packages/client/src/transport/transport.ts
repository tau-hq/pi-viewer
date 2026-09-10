import { TauTransport } from "./ws";

let instance: TauTransport | undefined;

/** Process-wide transport; created lazily so tests can construct their own. */
export function getTransport(): TauTransport {
	if (!instance) instance = new TauTransport();
	return instance;
}
