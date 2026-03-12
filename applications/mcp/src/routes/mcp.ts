import { handleMcpRequest, withWideEvent } from "../context";

const wrappedHandler = withWideEvent((request: Request) => handleMcpRequest(request));

const GET = (request: Request) => wrappedHandler(request);
const POST = (request: Request) => wrappedHandler(request);
const DELETE = (request: Request) => wrappedHandler(request);

export { DELETE, GET, POST };
