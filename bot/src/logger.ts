import { Logger } from "tslog";

const noColor = process.env.NO_COLOR === "1";

export const logger = new Logger({
  name: "club-bot",
  minLevel: 3,
  prettyLogTimeZone: "local",
  stylePrettyLogs: !noColor,
});
