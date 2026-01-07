const GET = (): Response =>
  Response.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });

export { GET };
