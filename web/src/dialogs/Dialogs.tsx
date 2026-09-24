import { useApp } from "../state/app";
import CompressDialog from "./CompressDialog";
import ExportDialog from "./ExportDialog";
import InsertDialog from "./InsertDialog";
import Modal from "./Modal";
import PasswordDialog from "./PasswordDialog";
import ResultDialog from "./ResultDialog";
import SplitDialog from "./SplitDialog";

export default function Dialogs() {
  const { prompt } = useApp();
  return (
    <>
      <MainDialog />
      {prompt && <PasswordDialog path={prompt.path} wrong={prompt.wrong} resolve={prompt.resolve} />}
    </>
  );
}

function MainDialog() {
  const { dialog, setDialog, openPath } = useApp();
  const close = () => setDialog({ kind: "none" });
  switch (dialog.kind) {
    case "compress":
      return <CompressDialog onlyIds={dialog.onlyIds} split={dialog.split} />;
    case "insert":
      return <InsertDialog at={dialog.at} />;
    case "split":
      return <SplitDialog ranges={dialog.ranges} maxMB={dialog.maxMB} onlyIds={dialog.onlyIds} />;
    case "export":
      return <ExportDialog split={dialog.split ?? null} onlyIds={dialog.onlyIds} />;
    case "result":
      return <ResultDialog jobId={dialog.jobId} plan={dialog.plan} onlyIds={dialog.onlyIds} split={dialog.split} />;
    case "changed":
      return (
        <Modal title="File đã thay đổi" onClose={close}
          actions={<><button onClick={close}>Để sau</button><button className="primary" onClick={() => openPath(dialog.path, true)}>Tải lại</button></>}>
          <p>File gốc đã bị sửa hoặc di chuyển kể từ lúc mở. Tải lại file sẽ bỏ các thay đổi chưa xuất.</p>
        </Modal>
      );
    case "error":
      return (
        <Modal title="Có lỗi xảy ra" onClose={close} actions={<button className="primary" onClick={close}>Đóng</button>}>
          <p>{dialog.message}</p>
        </Modal>
      );
    default:
      return null;
  }
}
