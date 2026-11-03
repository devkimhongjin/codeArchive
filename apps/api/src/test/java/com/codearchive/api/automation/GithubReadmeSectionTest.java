package com.codearchive.api.automation;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class GithubReadmeSectionTest {
  private static final String SECTION = GithubAppProvider.README_SECTION;
  private static final String START = GithubAppProvider.README_SECTION_START;
  private static final String END = GithubAppProvider.README_SECTION_END;

  @Test void addsTheSectionUnderALeadingTitleAndKeepsTheRest() {
    assertThat(GithubAppProvider.withReadmeSection("# Algorithms\n\n\nNotes\n")).isEqualTo("# Algorithms\n\n" + SECTION + "\n\nNotes\n");
    assertThat(GithubAppProvider.withReadmeSection("# Algorithms")).isEqualTo("# Algorithms\n\n" + SECTION + "\n");
  }

  @Test void putsTheSectionOnTopWhenTheReadmeDoesNotStartWithATitle() {
    assertThat(GithubAppProvider.withReadmeSection("<p align=\"center\">logo</p>\n")).isEqualTo(SECTION + "\n\n<p align=\"center\">logo</p>\n");
    assertThat(GithubAppProvider.withReadmeSection("#hashtag\n")).isEqualTo(SECTION + "\n\n#hashtag\n");
    assertThat(GithubAppProvider.withReadmeSection("")).isEqualTo(SECTION + "\n");
  }

  @Test void keepsCrlfLineEndingsAndAByteOrderMark() {
    String bom = String.valueOf((char) 0xFEFF);
    assertThat(GithubAppProvider.withReadmeSection(bom + "# 풀이\r\nNotes\r\n"))
        .isEqualTo(bom + "# 풀이\r\n\r\n" + SECTION.replace("\n", "\r\n") + "\r\n\r\nNotes\r\n");
  }

  @Test void refreshesAMovedSectionInPlaceAndIsStableOnceCurrent() {
    String moved = "# Algorithms\n\nNotes\n\n" + START + "\nold badge\n" + END + "\n\nFooter\n";
    String refreshed = GithubAppProvider.withReadmeSection(moved);

    assertThat(refreshed).isEqualTo("# Algorithms\n\nNotes\n\n" + SECTION + "\n\nFooter\n");
    assertThat(GithubAppProvider.withReadmeSection(refreshed)).isEqualTo(refreshed);
    assertThat(GithubAppProvider.withReadmeSection(GithubAppProvider.INITIAL_README)).isEqualTo(GithubAppProvider.INITIAL_README);
  }

  @Test void leavesDamagedOrRepeatedMarkersAlone() {
    assertThat(GithubAppProvider.withReadmeSection(START + "\nno end\n")).isNull();
    assertThat(GithubAppProvider.withReadmeSection(END + "\n" + START + "\n")).isNull();
    assertThat(GithubAppProvider.withReadmeSection(SECTION + "\n\n" + SECTION + "\n")).isNull();
  }

  @Test void badgeLinksToTheStoreListing() {
    assertThat(SECTION).startsWith(START).endsWith(END)
        .contains("[![Automated by CodeArchive](https://img.shields.io/badge/Automated%20by-CodeArchive-685ca9)](https://chromewebstore.google.com/detail/codearchive/mlhibjadcbklfdllkonhjjajhmhnoalj)");
  }
}
