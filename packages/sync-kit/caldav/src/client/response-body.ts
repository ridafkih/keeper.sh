const releaseResponseBody = async (response: Response): Promise<void> => {
  const { body } = response;
  if (!body || response.bodyUsed || body.locked) {
    return;
  }
  await body.cancel().then(
    () => null,
    () => null,
  );
};

export { releaseResponseBody };
