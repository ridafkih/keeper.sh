"use client";

import { Button, ButtonText } from "../../../components/button";
import { Modal } from "../../../compositions/modal/modal";
import { ModalProvider, useSetModalOpen } from "../../../compositions/modal/modal-context";
import { Copy } from "../../../components/copy";
import { Heading3 } from "../../../components/heading";

const OpenModalButton = () => {
  const setModalOpen = useSetModalOpen();

  return (
    <Button variant="outline" onClick={() => setModalOpen(true)}>
      <ButtonText>Open Modal</ButtonText>
    </Button>
  );
};

const ModalDemo = () => (
  <ModalProvider>
    <OpenModalButton />
    <Modal>
      <Heading3>Example Modal</Heading3>
      <Copy>This is an example modal. On desktop it appears centered, on mobile it slides up from the bottom as a sheet.</Copy>
    </Modal>
  </ModalProvider>
);

export { ModalDemo };
