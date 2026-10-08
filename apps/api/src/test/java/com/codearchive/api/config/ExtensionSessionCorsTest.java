package com.codearchive.api.config;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
class ExtensionSessionCorsTest {
  private static final String ORIGIN = "chrome-extension://oohlcmihldmfninmdcmanddfmhoonmdl";
  @Autowired MockMvc mvc;
  @Test void allowsOnlyPinnedExtensionAndRetainsSessionAndCsrfRequirements() throws Exception {
    mvc.perform(options("/api/settings").header("Origin", ORIGIN).header("Access-Control-Request-Method", "PUT").header("Access-Control-Request-Headers", "Content-Type,X-XSRF-TOKEN,X-CodeArchive-Github-Id"))
      .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", ORIGIN));
    mvc.perform(get("/api/solutions").header("Origin", ORIGIN)).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/solutions").header("Origin", ORIGIN).header("Authorization", "Bearer not-a-session")).andExpect(status().isUnauthorized());
    mvc.perform(post("/api/auth/logout").header("Origin", ORIGIN).with(user("test"))).andExpect(status().isForbidden());
    mvc.perform(post("/api/settings/automatic-sync").header("Origin", ORIGIN).with(user("test"))).andExpect(status().isForbidden());
    mvc.perform(post("/api/auth/logout").header("Origin", ORIGIN).with(user("test")).with(csrf())).andExpect(status().isNoContent());
    mvc.perform(options("/api/settings").header("Origin", "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").header("Access-Control-Request-Method", "PUT"))
      .andExpect(status().isForbidden());
    mvc.perform(options("/api/settings").header("Origin", "https://evil.test").header("Access-Control-Request-Method", "PUT"))
      .andExpect(status().isForbidden());
  }
}
