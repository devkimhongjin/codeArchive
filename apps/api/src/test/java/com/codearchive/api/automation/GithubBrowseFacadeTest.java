package com.codearchive.api.automation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Exercises the read-only GitHub target browser against a deterministic local provider. */
class GithubBrowseFacadeTest {
  private HttpServer server;
  private final AtomicInteger requests = new AtomicInteger();
  private boolean paginateTarget;
  private boolean includeEmptyRepository;

  @BeforeEach
  void start() throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", this::respond);
    server.start();
  }

  @AfterEach
  void stop() {
    if (server != null) server.stop(0);
  }

  @Test
  void filtersInstallationsThenScopesRepositoryBranchAndDirectories() throws Exception {
    GithubAppProvider provider = provider();

    assertThat(provider.installations("123"))
        .extracting(GithubAppProvider.InstallationChoice::id,
            GithubAppProvider.InstallationChoice::accountLogin)
        .containsExactly(org.assertj.core.groups.Tuple.tuple(44L, "OwNeR"));
    assertThat(provider.installations("300")).isEmpty();
    assertThatThrownBy(() -> provider.repositories("124", 44L, 1))
        .isInstanceOf(SecurityException.class);

    assertThat(provider.repositories("123", 44L, 1))
        .extracting(GithubAppProvider.RepositoryChoice::id,
            GithubAppProvider.RepositoryChoice::fullName,
            GithubAppProvider.RepositoryChoice::privateRepository)
        .containsExactly(org.assertj.core.groups.Tuple.tuple(7L, "owner/repo", true));
    assertThat(provider.repositories("123", 44L, 1).get(0).defaultBranch()).isEqualTo("release/v1");
    assertThat(provider.branches("123", 44L, 7L, 1))
        .extracting(GithubAppProvider.BranchChoice::name,
            GithubAppProvider.BranchChoice::protectedBranch,
            GithubAppProvider.BranchChoice::commitSha)
        .containsExactly(org.assertj.core.groups.Tuple.tuple("main", false,
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    assertThat(provider.directories("123", 44L, 7L, "main", "" ).directories())
        .containsExactly("src");
  }

  @Test
  void rejectsUnsafeDirectoryBeforeAnyProviderRequestAndFailsClosedUnconfigured() throws Exception {
    GithubAppProvider provider = provider();
    assertThatThrownBy(() -> provider.directories("123", 44L, 7L, "main", "../secret"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(requests.get()).isZero();

    GithubAppProvider unconfigured = new GithubAppProvider("", "", base(), HttpClient.newHttpClient(), new ObjectMapper());
    assertThatThrownBy(() -> unconfigured.installations("123"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("provider unavailable");
  }

  @Test
  void keepsARepositoryWithAnExplicitNullDefaultBranchVisible() throws Exception {
    includeEmptyRepository = true;
    GithubAppProvider provider = provider();

    assertThat(provider.repositories("123", 44L, 1))
        .extracting(GithubAppProvider.RepositoryChoice::name,
            GithubAppProvider.RepositoryChoice::defaultBranch)
        .contains(org.assertj.core.groups.Tuple.tuple("empty", null));
  }

  @Test
  void findsInstallationAndValidatedBranchOnLaterBoundedPages() throws Exception {
    paginateTarget = true;
    GithubAppProvider provider = provider();

    assertThat(provider.installations("123"))
        .extracting(GithubAppProvider.InstallationChoice::id)
        .containsExactly(44L);
    assertThat(provider.repositoriesPage("123", 44L, 1).hasMore()).isTrue();
    assertThat(provider.repositoriesPage("123", 44L, 1).items()).hasSize(99);
    assertThat(provider.branchesPage("123", 44L, 7L, 1).hasMore()).isTrue();
    assertThat(provider.branchesPage("123", 44L, 7L, 1).items()).hasSize(99);
    assertThat(provider.directories("123", 44L, 7L, "release/v1", "").directories())
        .containsExactly("src");
  }

  private GithubAppProvider provider() throws Exception {
    return new GithubAppProvider("99", pem(), base(), HttpClient.newHttpClient(), new ObjectMapper());
  }

  private String base() {
    return "http://127.0.0.1:" + server.getAddress().getPort();
  }

  private String pem() throws Exception {
    KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
    generator.initialize(2048);
    PrivateKey key = generator.generateKeyPair().getPrivate();
    return "-----BEGIN PRIVATE KEY-----\n"
        + Base64.getMimeEncoder(64, new byte[] {'\n'}).encodeToString(key.getEncoded())
        + "\n-----END PRIVATE KEY-----";
  }

  private void respond(HttpExchange exchange) throws IOException {
    requests.incrementAndGet();
    String path = exchange.getRequestURI().getPath();
    if (path.endsWith("/access_tokens")) {
      reply(exchange, 201, "{\"token\":\"installation-token\"}");
    } else if (path.equals("/app/installations")) {
      if (paginateTarget) {
        reply(exchange, 200, installationsPage(exchange.getRequestURI().getQuery()));
        return;
      }
      reply(exchange, 200, "[{\"id\":44,\"account\":{\"id\":123,\"login\":\"OwNeR\",\"type\":\"User\"},\"suspended_at\":null},"
          + "{\"id\":45,\"account\":{\"id\":124,\"login\":\"OwNeR\",\"type\":\"User\"},\"suspended_at\":null},"
          + "{\"id\":46,\"account\":{\"id\":300,\"login\":\"owner-org\",\"type\":\"Organization\"},\"suspended_at\":null}]");
    } else if (path.equals("/installation/repositories")) {
      if (paginateTarget) {
        reply(exchange, 200, repositoriesPage(exchange.getRequestURI().getQuery()));
        return;
      }
      reply(exchange, 200, "{\"repositories\":[{\"id\":7,\"owner\":{\"login\":\"owner\"},"
          + "\"name\":\"repo\",\"default_branch\":\"release/v1\",\"private\":true}"
          + (includeEmptyRepository ? ",{\"id\":8,\"owner\":{\"login\":\"owner\"},\"name\":\"empty\",\"default_branch\":null,\"private\":true}" : "")
          + "]}");
    } else if (path.equals("/repos/owner/repo/branches")) {
      if (paginateTarget) {
        reply(exchange, 200, branchesPage(exchange.getRequestURI().getQuery()));
        return;
      }
      reply(exchange, 200, "[{\"name\":\"main\",\"protected\":false,\"commit\":{\"sha\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}}]");
    } else if (path.equals("/repos/owner/repo/contents")) {
      reply(exchange, 200, "[{\"name\":\"src\",\"type\":\"dir\"},{\"name\":\"File.java\",\"type\":\"file\"},"
          + "{\"name\":\"link\",\"type\":\"symlink\"},{\"name\":\"sub\",\"type\":\"submodule\"}]");
    } else {
      reply(exchange, 404, "{}");
    }
  }

  private static String installationsPage(String query) {
    if (query != null && query.contains("page=2")) {
      return "[{\"id\":44,\"account\":{\"id\":123,\"login\":\"OwNeR\",\"type\":\"User\"},\"suspended_at\":null}]";
    }
    StringBuilder body = new StringBuilder("[");
    for (int id = 1; id <= 100; id++) {
      if (id > 1) body.append(',');
      body.append("{\"id\":").append(1000 + id)
          .append(",\"account\":{\"id\":").append(1000 + id)
          .append(",\"login\":\"other\",\"type\":\"User\"},\"suspended_at\":null}");
    }
    return body.append(']').toString();
  }

  private static String branchesPage(String query) {
    if (query != null && query.contains("page=2")) {
      return "[{\"name\":\"release/v1\",\"protected\":false,\"commit\":{\"sha\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}}]";
    }
    StringBuilder body = new StringBuilder("[");
    for (int id = 1; id <= 100; id++) {
      if (id > 1) body.append(',');
      body.append("{\"name\":\"").append(id == 100 ? "bad branch" : "branch-" + id)
          .append("\",\"protected\":false,\"commit\":{\"sha\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}}");
    }
    return body.append(']').toString();
  }

  private static String repositoriesPage(String query) {
    if (query != null && query.contains("page=2")) {
      return "{\"repositories\":[{\"id\":7,\"owner\":{\"login\":\"owner\"},\"name\":\"repo\",\"default_branch\":\"release/v1\",\"private\":true}]}";
    }
    StringBuilder body = new StringBuilder("{\"repositories\":[");
    for (int id = 1; id <= 100; id++) {
      if (id > 1) body.append(',');
      String owner = id == 100 ? "bad/owner" : "owner";
      body.append("{\"id\":").append(100 + id).append(",\"owner\":{\"login\":\"").append(owner)
          .append("\"},\"name\":\"repo-").append(id).append("\",\"default_branch\":\"main\",\"private\":true}");
    }
    return body.append("]}").toString();
  }

  private static void reply(HttpExchange exchange, int status, String body) throws IOException {
    byte[] bytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    exchange.sendResponseHeaders(status, bytes.length);
    exchange.getResponseBody().write(bytes);
    exchange.close();
  }
}
