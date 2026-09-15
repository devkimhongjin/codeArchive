import { mountArchive } from "./archiveView";

mountArchive(document, {
  load: () => chrome.runtime.sendMessage({ type: "GET_ARCHIVE_STATE" })
});
