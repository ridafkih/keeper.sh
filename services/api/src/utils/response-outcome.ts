const failedResponses = new WeakSet<Response>();

const asFailedResponse = (response: Response): Response => {
  failedResponses.add(response);
  return response;
};

const isFailedResponse = (response: Response): boolean => failedResponses.has(response);

export { asFailedResponse, isFailedResponse };
