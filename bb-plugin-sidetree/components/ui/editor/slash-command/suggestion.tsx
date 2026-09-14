import { ReactRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import CommandsList, { type CommandsListHandle, type SlashItem } from "./commands-list";
import type { SuggestionOptions as TiptapSuggestionOptions } from "@tiptap/suggestion";

export type ImagePickerUrlResult = {
  kind: "url";
  src: string;
  alt?: string;
  title?: string;
};

export type ImagePickerFileResult = {
  kind: "file";
  file: File;
  alt?: string;
  title?: string;
};

export type ImagePickerResult = ImagePickerUrlResult | ImagePickerFileResult;

export type ImagePickerContext = {
  editor: Editor;
  range: { from: number; to: number };
};

export type ImagePickerHandler = (
  context: ImagePickerContext,
) => ImagePickerResult | null | Promise<ImagePickerResult | null>;

type SuggestionOptions = {
  onRequestImage?: ImagePickerHandler | null;
  onInsertLocalImageFile?: ((context: ImagePickerContext & Omit<ImagePickerFileResult, "kind">) => void | Promise<void>) | null;
  enableImages?: boolean;
};

const TABLE_SAFE_COMMANDS = new Set(["Image"]);

type RequestImageAndInsertArgs = ImagePickerContext & {
  onRequestImage: ImagePickerHandler | null;
  onInsertLocalImageFile: ((context: ImagePickerContext & Omit<ImagePickerFileResult, "kind">) => void | Promise<void>) | null;
};

const requestImageAndInsert = async ({
  editor,
  range,
  onRequestImage,
  onInsertLocalImageFile,
}: RequestImageAndInsertArgs): Promise<void> => {
  let result: ImagePickerResult | null = null;
  if (onRequestImage) {
    result = await onRequestImage({ editor, range });
  }

  if (!result || editor.isDestroyed) return;
  if (result.kind === "url" && !result.src.trim()) return;

  if (result.kind === "file") {
    if (!onInsertLocalImageFile) return;
    editor.chain().focus().deleteRange(range).run();
    const fileInsertContext: ImagePickerContext & Omit<ImagePickerFileResult, "kind"> = {
      editor,
      range,
      file: result.file,
      ...(result.alt ? { alt: result.alt } : {}),
      ...(result.title ? { title: result.title } : {}),
    };
    await onInsertLocalImageFile(fileInsertContext);
    return;
  }

  const imageAttrs = {
    src: result.src,
    ...(result.alt ? { alt: result.alt } : {}),
    ...(result.title ? { title: result.title } : {}),
  };

  editor.chain().focus().setImage(imageAttrs).run();
};

const getAllItems = (options: SuggestionOptions): SlashItem[] => [
  {
    title: "Text",
    icon: "Pilcrow",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    title: "Heading 1",
    icon: "Heading1",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    icon: "Heading2",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    icon: "Heading3",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    title: "Bulleted list",
    icon: "List",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    icon: "ListOrdered",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: "Image",
    icon: "Image",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const from = editor.state.selection.from;
      void requestImageAndInsert({
        editor,
        range: { from, to: from },
        onRequestImage: options.onRequestImage ?? null,
        onInsertLocalImageFile: options.onInsertLocalImageFile ?? null,
      });
    },
  },
  {
    title: "Table",
    icon: "Table",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    title: "Quote",
    icon: "Quote",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: "Code block",
    icon: "Code",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
];

type SlashSuggestion = Pick<TiptapSuggestionOptions, "items" | "render" | "command">;
type SuggestionRenderLifecycle = NonNullable<ReturnType<NonNullable<SlashSuggestion["render"]>>>;
type SuggestionKeyDownProps = Parameters<NonNullable<SuggestionRenderLifecycle["onKeyDown"]>>[0];

const createSuggestion = (options: SuggestionOptions = {}): SlashSuggestion => {
  let popup: TippyInstance | null = null;

  return {
    items: ({ query, editor }: { query: string; editor: Editor }) => {
      const isInTableCell = editor.isActive("tableCell") || editor.isActive("tableHeader");
      return getAllItems(options)
        .filter((item) => !isInTableCell || TABLE_SAFE_COMMANDS.has(item.title))
        .filter((item) => options.enableImages !== false || item.title !== "Image")
        .filter((item) => item.title.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 10);
    },

    command: ({ editor, range, props }) => {
      popup?.hide();
      (props as SlashItem).command({ editor, range });
    },

    render: (): SuggestionRenderLifecycle => {
      let component: ReactRenderer<CommandsListHandle> | null = null;

      return {
        onStart: (props) => {
          component = new ReactRenderer(CommandsList, {
            props,
            editor: props.editor,
          });

          if (!props.clientRect) return;
          const referenceRect = () => props.clientRect?.() ?? new DOMRect(0, 0, 0, 0);

          popup = tippy(document.body, {
            getReferenceClientRect: referenceRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
          });
        },

        onUpdate: (props) => {
          if (!component) return;
          component.updateProps(props);
          if (!props.clientRect || !popup) return;
          const referenceRect = () => props.clientRect?.() ?? new DOMRect(0, 0, 0, 0);
          popup.setProps({ getReferenceClientRect: referenceRect });
        },

        onKeyDown: ({ event }: SuggestionKeyDownProps): boolean => {
          if (event.key === "Escape" && popup) {
            popup.hide();
            return true;
          }

          return component?.ref?.onKeyDown(event) ?? false;
        },

        onExit: (): void => {
          popup?.destroy();
          popup = null;
          component?.destroy();
        },
      };
    },
  };
};

export default createSuggestion;
