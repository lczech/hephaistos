// Forges: websites hosting git repositories, where a remote's page can be opened.

import { type SimpleIcon, siBitbucket, siCodeberg, siGithub, siGitlab } from "simple-icons";

const FORGES: Record<string, SimpleIcon> = {
  "github.com": siGithub,
  "gitlab.com": siGitlab,
  "bitbucket.org": siBitbucket,
  "codeberg.org": siCodeberg,
};

/** A remote's page on its forge: its URL, the forge's name and logo. */
export interface ForgePage {
  url: string;
  forge: string;
  icon: SimpleIcon;
}

/** The page of a remote as the API normalises it, `github.com/me/proj`; none off forges. */
export function forgePage(remote: string): ForgePage | undefined {
  const icon = FORGES[remote.split("/")[0] ?? ""];
  return icon && { url: `https://${remote}`, forge: icon.title, icon };
}
