"use client";

import { useState } from "react";
import { Button, ButtonText } from "../../../components/button";
import { Modal } from "../../../compositions/modal/modal";
import { Copy } from "../../../components/copy";
import { Heading3 } from "../../../components/heading";

const ModalDemo = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ButtonText>Open Modal</ButtonText>
      </Button>
      <Modal open={open} onClose={() => setOpen(false)}>
        <Heading3>Example Modal</Heading3>
        <Copy>This is an example modal. On desktop it appears centered, on mobile it slides up from the bottom as a sheet.</Copy>
      </Modal>
    </>
  );
};

export { ModalDemo };
