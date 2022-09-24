import "@logseq/libs";
import { SettingSchemaDesc } from "@logseq/libs/dist/LSPlugin.user";
// @ts-ignore
import Sherlock from "sherlockjs";
import { getDateForPage } from "logseq-dateutils";

let pageList: string[] = [];
let blockArray: string[] = [];
let dateFormat = "";

async function fetchAliases() { //from https://github.com/sawhney17/logseq-smartblocks
  let query = `
  [:find (pull ?b [*])
             :where
             [?b :block/properties ?p]
             [(get ?p :alias)]]
  `;
  let result = await logseq.DB.datascriptQuery(query)
  return result.map((item) => item[0].properties.alias);
}

async function fetchPropertyIgnoreList() {
  let query = `
  [:find (pull ?b [*])
             :where
             [?b :block/properties ?p]
             [(get ?p :automatic-ignore)]]
  `;
  let result = await logseq.DB.datascriptQuery(query)
  return result
    .filter((item) => item[0]["original-name"] && item[0].properties['automatic-ignore'])
    .map(item => [
      item[0]["original-name"].toUpperCase(),
      item[0].properties.alias?.map(alias => alias.toUpperCase()) ?? []
    ].flat())
    .flat()
}

const settings: SettingSchemaDesc[] = [
  {
    key: "enableAutoParse",
    description: "Automatically parse the block on enter",
    type: "boolean",
    default: false,
    title: "Automatically parse the block on enter",
  },
  {
    key: "stateKeybinding",
    description: "Keybinding to toggle Automatic Parsing",
    type: "string",
    default: "mod+shift+l",
    title: "Keybinding for Automatic Parsing",
  },
  {
    key: "parseSingleBlockKeybinding",
    description: "Keybinding to parse a single block",
    type: "string",
    default: "mod+p",
    title: "Keybinding for Parsing a Single Block",
  },
  {
    key: "parseSingleWordAsTag",
    description: "Parse single words as tags",
    type: "boolean",
    default: false,
    title: "Parse single words as tags",
  },
  {
    key: "parseAsTags",
    description: "Parse all links as tags",
    type: "boolean",
    default: false,
    title: "Parse all links as tags",
  },
  {
    key: "pagesToIgnore",
    description: "Pages to ignore when generating links",
    type: "string",
    default:
      "a,b,c,card,now,later,todo,doing,done,wait,waiting,canceled,cancelled,started,in-progress",
    title: "Pages to ignore when generating links",
  },
];
logseq.useSettingsSchema(settings);
async function getPages() {
  const propertyBasedIgnoreList = await fetchPropertyIgnoreList();
  let pagesToIgnore = logseq.settings?.pagesToIgnore
    .split(",")
    .map((x) => x.toUpperCase().trim())
    .concat(propertyBasedIgnoreList);
  pagesToIgnore = [...new Set(pagesToIgnore)];
  const query = `[:find (pull ?p [*]) :where [?p :block/uuid ?u][?p :block/original-name]]`;
  logseq.DB.datascriptQuery(query).then(async (results) => {
    console.log({LogseqAutomaticLinker: "results", results})
    pageList = results
      .filter(
        (x) => !pagesToIgnore.includes(x[0]["original-name"].toUpperCase())
      )
      .map((x) => x[0]["original-name"])
      .filter((x) => x);
    console.log({LogseqAutomaticLinker: "pageList", pageList})
    pageList.concat(await fetchAliases());
  });


}
const parseForRegex = (s: string) => {

  //Remove regex special characters from s
  // s = s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
  s = s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

  return s
    // .replaceAll("[", "\\[")
    // .replaceAll("]", "\\]")
    // .replaceAll(")", "\\)")
    // .replaceAll("(", "\\(")
    // .replaceAll("+", "\\+")
    // .replaceAll("-", "\\-")
    // .replaceAll("{", "\\{")
    // .replaceAll("}", "\\}")
    // .replaceAll("*", "\\*")
    // .replaceAll("?", "\\?")
    // .replaceAll(".", "\\.")
    // .replaceAll("^", "\\^")
    // .replaceAll("$", "\\$")
    // .replaceAll("|", "\\|")
    // .replaceAll("\\", "\\\\")
    // .replaceAll("/", "\\/")
    // .replaceAll(" ", "\\s+");
};

// Use random UUIDs instead of manually generated strings
const CODE_BLOCK_PLACEHOLDER = "71e46a9e-1150-49c3-a04b-0491ebe05922"
const INLINE_CODE_PLACEHOLDER = "164b97c2-beb7-4204-99b4-6ec2ddc93f9c"
const PROPERTY_PLACEHOLDER = "50220b1c-63f0-4f57-aa73-08c4d936a419"
const MARKDOWN_LINK_PLACEHOLDER = "53c65a4a-137d-44a8-8849-8ec6ca411942"


async function parseBlockForLink(d: string) {
  if (d != null) {
    let block = await logseq.Editor.getBlock(d);
    console.log({LogseqAutomaticLinker: "block", block})
    if (block == null) {
      return
    }

    let content = block.content.replaceAll(/{.*}/g, (match) => {
      return getDateForPage(
        Sherlock.parse(match.slice(1, -1)).startDate,
        dateFormat
      );
    });

    // Handle content that should not be automatically linked
    let codeblockReversalTracker = [];
    let inlineCodeReversalTracker = [];
    let propertyTracker = [];
    let markdownLinkTracker = [];

    content = content.replaceAll(/```(.|\n)*```/gim, (match) => {
      codeblockReversalTracker.push(match);
      console.log({LogseqAutomaticLinker: "code block found", match})
      return CODE_BLOCK_PLACEHOLDER;
    });

    content = content.replaceAll(/(?=`)`(?!`)[^`]*(?=`)`(?!`)/g, (match) => {
      inlineCodeReversalTracker.push(match);
      console.log({LogseqAutomaticLinker: "inline code found", match})
      return INLINE_CODE_PLACEHOLDER;
    });

    content = content.replaceAll(/ *[^\s]+:: /g, (match) => {
      propertyTracker.push(match);
      console.log({LogseqAutomaticLinker: "property found", match})
      return PROPERTY_PLACEHOLDER;
    });

    // Broken Markdown links with nested pages won't be detected by this regex and have to be fixed manually.
    // Example: [[[page]] This is a broken Markdown link](http://example.com)
    content = content.replaceAll(/\[[^\[\]]+\]\([^\(\)]+\)/g, (match) => {
      markdownLinkTracker.push(match);
      console.log({LogseqAutomaticLinker: "Markdown link found", match})
      return MARKDOWN_LINK_PLACEHOLDER;
    });

    let needsUpdate = false;

    pageList.forEach((value) => {
      const regex = new RegExp(
        `(\\w*(?<!\\[{2}[^[\\]]*)\\w*(?<!\\#)\\w*(?<!\\w+:\\/\\/\\S*))\\b(${parseForRegex(
          value
        )})(?![^[\\]]*\\]{2})\\b`,
        "gi"
      );
      // console.log({LogseqAutomaticLinker: "value", value})
      const chineseRegex = new RegExp(`(?<!\\[)${parseForRegex(value)}(?!\\])`, "gm")
      if (value.match(/^[\u4e00-\u9fa5]{0,}$/gm)) {
        content = content.replaceAll(chineseRegex, logseq.settings?.parseAsTags ? `#${value}` : `[[${value}]]`);
        needsUpdate = true
      }
      else if (value.length > 0) {
        if (content.toUpperCase().includes(value.toUpperCase())) {
          content = content.replaceAll(regex, (match) => {
            const hasSpaces = /\s/g.test(match);
            if (
              logseq.settings?.parseAsTags ||
              (logseq.settings?.parseSingleWordAsTag && !hasSpaces)
            ) {
              return hasSpaces ? `#[[${value}]]` : `#${value}`;
            }
            return `[[${value}]]`;
          });
          needsUpdate = true;
          // setTimeout(() => { inProcess = false }, 300)
        }
      }
      //if value is chinese
    });

    // Restore content that should not be automatically linked
    codeblockReversalTracker?.forEach((value, index) => {
      content = content.replace(CODE_BLOCK_PLACEHOLDER, value);
    });
    inlineCodeReversalTracker?.forEach((value, index) => {
      content = content.replace(INLINE_CODE_PLACEHOLDER, value);
    });
    propertyTracker?.forEach((value, index) => {
      content = content.replace(PROPERTY_PLACEHOLDER, value);
    });
    markdownLinkTracker?.forEach((value, index) => {
      content = content.replace(MARKDOWN_LINK_PLACEHOLDER, value);
    });

    if (needsUpdate) {
      logseq.Editor.updateBlock(block.uuid, `${content}`);
    }
  }
}

const main = async () => {
  getPages();
  dateFormat = (await logseq.App.getUserConfigs()).preferredDateFormat;
  logseq.DB.onChanged((e) => {
    if (e.txMeta?.outlinerOp == "insertBlocks") {
      if (logseq.settings?.enableAutoParse) {
        blockArray?.forEach(parseBlockForLink);
      }
      // console.log({LogseqAutomaticLinker: "Enter pressed"})
      blockArray = [];
    } else {
      // console.log({LogseqAutomaticLinker: "Something changed"})
      //if blocks array doesn't already contain the block uuid, push to it
      const block = e.blocks[0].uuid;
      if (!blockArray.includes(block)) {
        blockArray.push(block);
      }
    }
  });
  logseq.App.onCurrentGraphChanged(getPages);
  logseq.Editor.registerBlockContextMenuItem("Parse Block for Links", (e) => {
    return parseBlockForLink(e.uuid);
  });
  logseq.App.registerCommandShortcut(
    { binding: logseq.settings?.stateKeybinding },
    () => {
      getPages();
      blockArray = [];
      const enabledText = logseq.settings?.enableAutoParse
        ? "disabled"
        : "enabled";
      logseq.App.showMsg(`Auto Parse Links ${enabledText}`);
      logseq.updateSettings({
        enableAutoParse: !logseq.settings?.enableAutoParse,
      });
    }
  );
  logseq.App.registerCommandShortcut(
    { binding: logseq.settings?.parseSingleBlockKeybinding },
    (e) => {
      getPages();
      if (!logseq.settings?.enableAutoParse) {
        parseBlockForLink(e.uuid);
      }
    }
  );
};
logseq.ready(main).catch(console.error);
