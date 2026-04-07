export interface BunTimeoutServer {
	timeout(request: Request, seconds: number): void;
}

export function isSessionStreamPath(pathname: string): boolean {
	const parts = pathname.split("/");
	return (
		parts.length === 4 &&
		parts[1] === "messages" &&
		parts[2] !== "" &&
		parts[3] === "stream"
	);
}

export function createFetchHandler(
	appFetch: (request: Request) => Response | Promise<Response>,
): (
	request: Request,
	server: BunTimeoutServer,
) => Response | Promise<Response> {
	return (request, server) => {
		if (isSessionStreamPath(new URL(request.url).pathname)) {
			server.timeout(request, 0);
		}
		return appFetch(request);
	};
}
