import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import createSuggestion, {
  type ImagePickerFileResult,
  type ImagePickerHandler,
  type ImagePickerContext,
} from "./suggestion";

type SlashCommandsOptions = {
  onRequestImage: ImagePickerHandler | null;
  onInsertLocalImageFile: ((context: ImagePickerContext & Omit<ImagePickerFileResult, "kind">) => void | Promise<void>) | null;
  enableImages: boolean;
};

const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: "slash-commands",

  addOptions() {
    return {
      onRequestImage: null,
      onInsertLocalImageFile: null,
      enableImages: true,
    };
  },

  addProseMirrorPlugins() {
    const suggestion = createSuggestion({
      onRequestImage: this.options.onRequestImage,
      onInsertLocalImageFile: this.options.onInsertLocalImageFile,
      enableImages: this.options.enableImages,
    });

    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        ...suggestion,
      }),
    ];
  },
});

export default SlashCommands;
