package com.codearchive.api.settings;

import static org.assertj.core.api.Assertions.assertThat;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.Method;
import org.junit.jupiter.api.Test;

class SettingsThemeValidationTest {
  private String validate(String light, String dark) throws Exception {
    Method method = SettingsController.class.getDeclaredMethod("validate", SettingsRequest.class);
    method.setAccessible(true);
    return (String) method.invoke(null, new SettingsRequest(0, "Name", "nick", false, false, false,
        "{number}", "archive/{number}/{capture_ID}", "Add {platform} {number}", light, dark,
        false, false, null, null, null, null, null));
  }

  @Test void acceptsAllBundledThemesOnlyInTheirCorrectSlot() throws Exception {
    try (var resource = getClass().getResourceAsStream("/shiki-themes.json")) {
      var themes = new ObjectMapper().readTree(resource);
      assertThat(themes.size()).isEqualTo(65);
      for (var theme : themes) {
        String id = theme.get("id").asText();
        boolean light = theme.get("type").asText().equals("light");
        assertThat(validate(light ? id : "github-light", light ? "github-dark" : id)).as(id).isNull();
        assertThat(validate(light ? "github-light" : id, light ? id : "github-dark")).as(id + " wrong slot").isEqualTo("Unsupported Shiki theme");
      }
    }
    assertThat(validate("not-a-theme", "github-dark")).isEqualTo("Unsupported Shiki theme");
    assertThat(validate(null, "github-dark")).isEqualTo("Unsupported Shiki theme");
    assertThat(validate("github-light", null)).isEqualTo("Unsupported Shiki theme");
  }
}
