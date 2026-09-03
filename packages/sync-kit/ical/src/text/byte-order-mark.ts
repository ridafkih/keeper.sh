const byteOrderMark = "﻿";

const stripByteOrderMark = (body: string): string => {
  if (!body.startsWith(byteOrderMark)) {
    return body;
  }
  return body.slice(byteOrderMark.length);
};

export { stripByteOrderMark };
