import { handleMcpRequest } from "../context";

const GET = (request: Request) => handleMcpRequest(request);
const POST = (request: Request) => handleMcpRequest(request);
const DELETE = (request: Request) => handleMcpRequest(request);

export { DELETE, GET, POST };
