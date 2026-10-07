package com.codearchive.api.automation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class GithubFileAdditionTest {
  private static final String HEAD = "a".repeat(40);
  private static final String MOVED = "f".repeat(40);
  private static final String ROOT = "b".repeat(40);
  private static final String CHILD = "c".repeat(40);
  private static final String NEW_TREE = "d".repeat(40);
  private static final String NEW_COMMIT = "e".repeat(40);
  private static final String FILE = "1".repeat(40);
  private static final String RESULT_CHILD = "2".repeat(40);
  private final ObjectMapper json = new ObjectMapper();
  private final AtomicInteger mutations = new AtomicInteger();
  private final AtomicInteger refReads = new AtomicInteger();
  private final AtomicInteger refUpdates = new AtomicInteger();
  private HttpServer server;
  private boolean protectedBranch;
  private boolean truncatedChild, oversizedChild, unsafeChild, staleOperationTree;
  private boolean staleEditedTree;
  private boolean includeUnicodeFile;
  private boolean reflectRefUpdates;
  private int moveAtRefRead;
  private JsonNode treeRequest;
  private JsonNode refUpdateRequest;
  private String pem;

  @BeforeEach void start() throws Exception {
    var keys = KeyPairGenerator.getInstance("RSA"); keys.initialize(2048);
    pem = "-----BEGIN PRIVATE KEY-----\n" + Base64.getMimeEncoder(64, new byte[] {'\n'}).encodeToString(keys.generateKeyPair().getPrivate().getEncoded()) + "\n-----END PRIVATE KEY-----";
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", this::respond);
    server.start();
  }

  @AfterEach void stop() { if (server != null) server.stop(0); }

  @Test void addsOneNewFileWithNonForceRefUpdate() throws Exception {
    String result = provider().addFile("123", 44, 7, "main", "src/New.java", "class New {}", "Add new file", HEAD, false);

    assertThat(result).isEqualTo(NEW_COMMIT);
    assertThat(mutations).hasValue(2);
    assertThat(refUpdates).hasValue(1);
    assertThat(treeRequest.path("base_tree").asText()).isEqualTo(ROOT);
    assertThat(treeRequest.path("tree").get(0).path("path").asText()).isEqualTo("src/New.java");
    assertThat(treeRequest.path("tree").get(0).path("content").asText()).isEqualTo("class New {}");
    assertThat(refUpdateRequest.path("force").asBoolean(true)).isFalse();
  }

  @Test void replacesOnlyTheExactPreviouslyReadFileWithANonForceCommit() throws Exception {
    String result = provider().replaceFile("123", 44, 7, "main", "src/File.java", "new", "Edit file", HEAD, FILE);
    assertThat(result).isEqualTo(NEW_COMMIT);
    assertThat(mutations).hasValue(2);
    assertThat(refUpdates).hasValue(1);
    assertThat(treeRequest.path("tree").get(0).path("path").asText()).isEqualTo("src/File.java");
    assertThat(treeRequest.path("tree").get(0).path("content").asText()).isEqualTo("new");
    assertThat(refUpdateRequest.path("force").asBoolean(true)).isFalse();
  }

  @Test void editsEmptyAndUnicodeMultilineContentWithoutChangingOtherFiles() throws Exception {
    includeUnicodeFile = true;
    assertThat(provider().replaceFile("123", 44, 7, "main", "풀이.java", "", "Clear file", HEAD, FILE)).isEqualTo(NEW_COMMIT);
    assertThat(treeRequest.path("tree").get(0).path("content").asText()).isEmpty();
    assertThat(refUpdates).hasValue(1);
    mutations.set(0); refUpdates.set(0); treeRequest = null;
    assertThat(provider().replaceFile("123", 44, 7, "main", "풀이.java", "한글\n둘째 줄\n", "Edit file", HEAD, FILE)).isEqualTo(NEW_COMMIT);
    assertThat(treeRequest.path("tree").get(0).path("content").asText()).isEqualTo("한글\n둘째 줄\n");
    assertThat(refUpdates).hasValue(1);
  }

  @Test void duplicateConfirmationCannotUpdateTheRefTwiceAfterTheFirstCommit() throws Exception {
    reflectRefUpdates = true;
    GithubAppProvider provider = provider();
    assertThat(provider.replaceFile("123", 44, 7, "main", "src/File.java", "new", "Edit file", HEAD, FILE)).isEqualTo(NEW_COMMIT);
    assertThatThrownBy(() -> provider.replaceFile("123", 44, 7, "main", "src/File.java", "new", "Edit file", HEAD, FILE))
        .isInstanceOf(GithubAppProvider.TargetConflictException.class);
    assertThat(refUpdates).hasValue(1);
  }

  @Test void resolvesSavedRepositoryNamesFromTheInstallationInsteadOfTrustingTheClientId() throws Exception {
    GithubAppProvider provider = provider();
    assertThat(provider.matchesRepository("123", 44, 7, "owner", "repo")).isTrue();
    assertThat(provider.matchesRepository("123", 44, 7, "owner", "different")).isFalse();
    assertThatThrownBy(() -> provider.matchesRepository("123", 44, 8, "owner", "repo"))
        .isInstanceOf(SecurityException.class);
    assertThat(mutations).hasValue(0);
    assertThat(refUpdates).hasValue(0);
  }

  @Test void rejectsEditedFileDriftAndAStaleTreeBeforeTheRefMutation() throws Exception {
    GithubAppProvider provider = provider();
    assertThatThrownBy(() -> provider.replaceFile("123", 44, 7, "main", "src/File.java", "new", "Edit", HEAD, MOVED))
        .isInstanceOf(GithubAppProvider.TargetConflictException.class);
    assertThatThrownBy(() -> provider.replaceFile("123", 44, 7, "main", "src/File.java", "new", "Edit", MOVED, FILE))
        .isInstanceOf(GithubAppProvider.TargetConflictException.class);
    protectedBranch = true;
    assertThatThrownBy(() -> provider.replaceFile("123", 44, 7, "main", "src/File.java", "new", "Edit", HEAD, FILE))
        .isInstanceOf(GithubAppProvider.TargetConflictException.class);
    protectedBranch = false;
    staleEditedTree = true;
    assertThatThrownBy(() -> provider.replaceFile("123", 44, 7, "main", "src/File.java", "new", "Edit", HEAD, FILE))
        .isInstanceOf(GithubAppProvider.TargetConflictException.class);
    assertThat(refUpdates).hasValue(0);
  }

  @Test void supportsAUnicodeFileNameAndRejectsLateBranchMovement() throws Exception {
    includeUnicodeFile = true;
    assertThat(provider().replaceFile("123", 44, 7, "main", "풀이.java", "new", "Edit", HEAD, FILE)).isEqualTo(NEW_COMMIT);
    assertThat(treeRequest.path("tree").get(0).path("path").asText()).isEqualTo("풀이.java");
    includeUnicodeFile = false;
    refReads.set(0); mutations.set(0); refUpdates.set(0); moveAtRefRead = 4;
    assertThatThrownBy(() -> provider().replaceFile("123", 44, 7, "main", "src/File.java", "new", "Edit", HEAD, FILE))
        .isInstanceOf(GithubAppProvider.TargetConflictException.class);
    assertThat(refUpdates).hasValue(0);
  }

  @Test void previewsThenDeletesAUnicodeNamedFileWithoutAForcedRefUpdate() throws Exception {
    includeUnicodeFile = true;
    GithubAppProvider provider = provider();
    var preview = provider.previewOperation("123", 44, 7,
        new GithubAppProvider.OperationPreviewRequest("DELETE", "main", "풀이.java", null, "Delete file", HEAD));
    assertThat(preview.changes()).containsExactly(new GithubAppProvider.TreeChange("풀이.java", null));
    assertThat(mutations).hasValue(0);
    assertThat(provider.commitOperation("123", 44, 7, preview.previewId())).isEqualTo(NEW_COMMIT);
    assertThat(refUpdates).hasValue(1);
    assertThat(refUpdateRequest.path("force").asBoolean(true)).isFalse();
  }

  @Test void addsOnlyAnExplicitEmptyFolderPlaceholder() throws Exception {
    assertThat(provider().addFile("123", 44, 7, "main", "new-folder/.gitkeep", "", "Add folder", HEAD, true)).isEqualTo(NEW_COMMIT);
    assertThat(treeRequest.path("tree").get(0).path("path").asText()).isEqualTo("new-folder/.gitkeep");
    assertThatThrownBy(() -> provider().addFile("123", 44, 7, "main", "new-folder/.gitkeep", "", "Add folder", HEAD, false)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test void rejectsStaleHeadAndProtectedBranchBeforeMutation() throws Exception {
    assertThatThrownBy(() -> provider().addFile("123", 44, 7, "main", "src/New.java", "new", "Add", MOVED, false))
        .isInstanceOf(GithubAppProvider.TargetConflictException.class).hasMessageContaining("branch moved");
    assertThat(mutations).hasValue(0);
    protectedBranch = true;
    assertThatThrownBy(() -> provider().addFile("123", 44, 7, "main", "src/New.java", "new", "Add", HEAD, false))
        .isInstanceOf(GithubAppProvider.TargetConflictException.class).hasMessageContaining("protected");
    assertThat(mutations).hasValue(0);
  }

  @Test void rejectsOverwriteCaseCollisionAndMissingParentBeforeMutation() throws Exception {
    GithubAppProvider provider = provider();
    for (String path : new String[] { "README.md", "readme.md", "src/File.java", "src/file.java", "SRC/New.java", "missing/New.java" }) {
      assertThatThrownBy(() -> provider.addFile("123", 44, 7, "main", path, "new", "Add", HEAD, false))
          .isInstanceOf(GithubAppProvider.TargetConflictException.class);
    }
    assertThat(mutations).hasValue(0);
  }

  @Test void rejectsInvalidPathAndPlaceholderBeforeAnyNetworkMutation() throws Exception {
    GithubAppProvider provider = provider();
    for (String path : new String[] { "../secret", "/absolute", "src/.git/config", "src/./file", "src\\file" }) {
      assertThatThrownBy(() -> provider.addFile("123", 44, 7, "main", path, "new", "Add", HEAD, false))
          .isInstanceOf(IllegalArgumentException.class);
    }
    assertThatThrownBy(() -> provider.addFile("123", 44, 7, "main", "new-folder/.gitkeep", "not empty", "Add", HEAD, true))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(mutations).hasValue(0);
  }

  @Test void rechecksHeadBeforeObjectCreationAndFinalRefUpdate() throws Exception {
    moveAtRefRead = 2;
    assertThatThrownBy(() -> provider().addFile("123", 44, 7, "main", "src/New.java", "new", "Add", HEAD, false))
        .isInstanceOf(GithubAppProvider.TargetConflictException.class);
    assertThat(mutations).hasValue(0);
    assertThat(refUpdates).hasValue(0);

    moveAtRefRead = 3;
    refReads.set(0);
    assertThatThrownBy(() -> provider().addFile("123", 44, 7, "main", "src/New.java", "new", "Add", HEAD, false))
        .isInstanceOf(GithubAppProvider.TargetConflictException.class);
    assertThat(mutations).hasValue(2);
    assertThat(refUpdates).hasValue(0);
  }

  @Test void previewsThenMovesAnExistingFileWithOneNonForceCommit() throws Exception {
    GithubAppProvider provider = provider();
    var preview = provider.previewOperation("123", 44, 7,
        new GithubAppProvider.OperationPreviewRequest("MOVE", "main", "src/File.java", "src/Archived.java", "Move file", HEAD));

    assertThat(preview.changes()).containsExactly(new GithubAppProvider.TreeChange("src/File.java", "src/Archived.java"));
    assertThat(mutations).hasValue(0);
    assertThat(refUpdates).hasValue(0);

    assertThat(provider.commitOperation("123", 44, 7, preview.previewId())).isEqualTo(NEW_COMMIT);
    assertThat(mutations).hasValue(2);
    assertThat(refUpdates).hasValue(1);
    assertThat(treeRequest.path("tree").get(0).path("path").asText()).isEqualTo("src/Archived.java");
    assertThat(treeRequest.path("tree").get(0).path("sha").asText()).isEqualTo(FILE);
    assertThat(treeRequest.path("tree").get(1).path("path").asText()).isEqualTo("src/File.java");
    assertThat(treeRequest.path("tree").get(1).path("sha").isNull()).isTrue();
    assertThat(refUpdateRequest.path("force").asBoolean(true)).isFalse();
  }

  @Test void rejectsUnsafeTreeOperationBeforeAnyRefUpdate() throws Exception {
    GithubAppProvider provider = provider();
    assertThatThrownBy(() -> provider.previewOperation("123", 44, 7,
        new GithubAppProvider.OperationPreviewRequest("MOVE", "main", "src", "src/again", "Move", HEAD)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> provider.previewOperation("123", 44, 7,
        new GithubAppProvider.OperationPreviewRequest("MOVE", "main", "src/File.java", "README.md", "Move", HEAD)))
        .isInstanceOf(GithubAppProvider.TargetConflictException.class);
    assertThat(mutations).hasValue(0);
    assertThat(refUpdates).hasValue(0);
  }

  @Test void movesAndDeletesACompleteFolderWithTreeIdentityAndOneRefUpdate() throws Exception {
    GithubAppProvider provider = provider();
    var move = provider.previewOperation("123", 44, 7,
        new GithubAppProvider.OperationPreviewRequest("MOVE", "main", "src", "archive", "Move folder", HEAD));
    assertThat(move.changes()).containsExactly(new GithubAppProvider.TreeChange("src/File.java", "archive/File.java"));
    assertThat(mutations).hasValue(0);

    // A separately constructed provider proves that a preview token is not
    // bound to process-local memory (as it cannot be on Cloud Run).
    assertThat(provider().commitOperation("123", 44, 7, move.previewId())).isEqualTo(NEW_COMMIT);
    assertThat(treeRequest.path("tree").get(0).path("path").asText()).isEqualTo("archive/File.java");
    assertThat(treeRequest.path("tree").get(0).path("type").asText()).isEqualTo("blob");
    assertThat(treeRequest.path("tree").get(0).path("mode").asText()).isEqualTo("100644");
    assertThat(treeRequest.path("tree").get(0).path("sha").asText()).isEqualTo(FILE);
    assertThat(treeRequest.path("tree").get(1).path("path").asText()).isEqualTo("src/File.java");
    assertThat(treeRequest.path("tree").get(1).path("type").asText()).isEqualTo("blob");
    assertThat(treeRequest.path("tree").get(1).path("sha").isNull()).isTrue();
    assertThat(refUpdates).hasValue(1);

    mutations.set(0); refUpdates.set(0);
    var delete = provider.previewOperation("123", 44, 7,
        new GithubAppProvider.OperationPreviewRequest("DELETE", "main", "src", null, "Delete folder", HEAD));
    assertThat(delete.changes()).containsExactly(new GithubAppProvider.TreeChange("src/File.java", null));
    assertThat(provider.commitOperation("123", 44, 7, delete.previewId())).isEqualTo(NEW_COMMIT);
    assertThat(treeRequest.path("tree")).hasSize(1);
    assertThat(treeRequest.path("tree").get(0).path("path").asText()).isEqualTo("src/File.java");
    assertThat(treeRequest.path("tree").get(0).path("type").asText()).isEqualTo("blob");
    assertThat(treeRequest.path("tree").get(0).path("sha").isNull()).isTrue();
    assertThat(refUpdates).hasValue(1);
  }

  @Test void rejectsFolderStaleHeadProtectedAndBoundedTraversalBeforeMutation() throws Exception {
    GithubAppProvider provider = provider();
    assertThatThrownBy(() -> provider.previewOperation("123", 44, 7,
        new GithubAppProvider.OperationPreviewRequest("DELETE", "main", "src", null, "Delete", MOVED)))
        .isInstanceOf(GithubAppProvider.TargetConflictException.class).hasMessageContaining("branch moved");
    protectedBranch = true;
    assertThatThrownBy(() -> provider.previewOperation("123", 44, 7,
        new GithubAppProvider.OperationPreviewRequest("DELETE", "main", "src", null, "Delete", HEAD)))
        .isInstanceOf(GithubAppProvider.TargetConflictException.class).hasMessageContaining("protected");
    protectedBranch = false; truncatedChild = true;
    assertThatThrownBy(() -> provider.previewOperation("123", 44, 7,
        new GithubAppProvider.OperationPreviewRequest("DELETE", "main", "src", null, "Delete", HEAD)))
        .isInstanceOf(GithubAppProvider.ProviderUnavailableException.class).hasMessageContaining("truncated");
    truncatedChild = false; oversizedChild = true;
    assertThatThrownBy(() -> provider.previewOperation("123", 44, 7,
        new GithubAppProvider.OperationPreviewRequest("DELETE", "main", "src", null, "Delete", HEAD)))
        .isInstanceOf(GithubAppProvider.TargetConflictException.class).hasMessageContaining("file limit");
    oversizedChild = false; unsafeChild = true;
    assertThatThrownBy(() -> provider.previewOperation("123", 44, 7,
        new GithubAppProvider.OperationPreviewRequest("DELETE", "main", "src", null, "Delete", HEAD)))
        .isInstanceOf(GithubAppProvider.TargetConflictException.class).hasMessageContaining("unsafe repository entry");
    assertThat(mutations).hasValue(0);
    assertThat(refUpdates).hasValue(0);
  }

  @Test void rejectsA201TreeThatStillContainsTheSourceBeforeCommitOrRefUpdate() throws Exception {
    GithubAppProvider provider = provider();
    var preview = provider.previewOperation("123", 44, 7,
        new GithubAppProvider.OperationPreviewRequest("DELETE", "main", "src", null, "Delete", HEAD));
    staleOperationTree = true;

    assertThatThrownBy(() -> provider.commitOperation("123", 44, 7, preview.previewId()))
        .isInstanceOf(GithubAppProvider.TargetConflictException.class);
    assertThat(mutations).hasValue(1); // orphan tree object only; no visible Git ref mutation
    assertThat(refUpdates).hasValue(0);
  }

  private GithubAppProvider provider() throws Exception {
    return new GithubAppProvider("99", pem, "http://127.0.0.1:" + server.getAddress().getPort(), HttpClient.newHttpClient(), json);
  }

  private void respond(HttpExchange exchange) throws IOException {
    String path = exchange.getRequestURI().getPath(), method = exchange.getRequestMethod();
    if (path.equals("/app/installations")) reply(exchange, 200, "[{\"id\":44,\"account\":{\"id\":123,\"login\":\"owner\",\"type\":\"User\"},\"suspended_at\":null}]");
    else if (path.endsWith("/access_tokens")) reply(exchange, 201, "{\"token\":\"installation-token\"}");
    else if (path.equals("/installation/repositories")) reply(exchange, 200, "{\"repositories\":[{\"id\":7,\"owner\":{\"login\":\"owner\"},\"name\":\"repo\",\"default_branch\":\"main\",\"private\":true}]}");
    else if (path.equals("/repos/owner/repo/branches")) reply(exchange, 200, "[{\"name\":\"main\",\"protected\":" + protectedBranch + ",\"commit\":{\"sha\":\"" + HEAD + "\"}}]");
    else if (path.equals("/repos/owner/repo/git/ref/heads/main") && method.equals("GET")) {
      int read = refReads.incrementAndGet();
      reply(exchange, 200, "{\"ref\":\"refs/heads/main\",\"object\":{\"sha\":\"" + (reflectRefUpdates && refUpdates.get() > 0 ? NEW_COMMIT : moveAtRefRead > 0 && read >= moveAtRefRead ? MOVED : HEAD) + "\"}}");
    } else if (path.equals("/repos/owner/repo/git/commits/" + HEAD) && method.equals("GET")) reply(exchange, 200, "{\"tree\":{\"sha\":\"" + ROOT + "\"}}");
    else if (path.equals("/repos/owner/repo/git/commits/" + NEW_COMMIT) && method.equals("GET") && reflectRefUpdates) reply(exchange, 200, "{\"tree\":{\"sha\":\"" + NEW_TREE + "\"}}");
    else if (path.equals("/repos/owner/repo/git/trees/" + ROOT) && method.equals("GET")) reply(exchange, 200, rootTree());
    else if (path.equals("/repos/owner/repo/git/trees/" + NEW_TREE) && method.equals("GET")) reply(exchange, 200, operationResultTree());
    else if (path.equals("/repos/owner/repo/git/trees/" + RESULT_CHILD) && method.equals("GET")) reply(exchange, 200, editedChildTree());
    else if (path.equals("/repos/owner/repo/git/trees/" + CHILD) && method.equals("GET")) {
      if (truncatedChild) reply(exchange, 200, "{\"truncated\":true,\"tree\":[]}");
      else if (oversizedChild) { StringBuilder files = new StringBuilder("{\"truncated\":false,\"tree\":["); for (int i = 0; i < 101; i++) { if (i > 0) files.append(','); files.append("{\"path\":\"F").append(i).append(".java\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"").append(FILE).append("\"}"); } reply(exchange, 200, files.append("]}").toString()); }
      else if (unsafeChild) reply(exchange, 200, "{\"truncated\":false,\"tree\":[{\"path\":\"../escape\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"" + FILE + "\"}]}");
      else reply(exchange, 200, "{\"truncated\":false,\"tree\":[{\"path\":\"File.java\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"" + FILE + "\",\"size\":3}]}");
    }
    else if (path.equals("/repos/owner/repo/git/blobs/" + FILE) && method.equals("GET")) reply(exchange, 200, "{\"sha\":\"" + FILE + "\",\"encoding\":\"base64\",\"size\":3,\"content\":\"b2xk\"}");
    else if (reflectRefUpdates && treeRequest != null && path.equals("/repos/owner/repo/git/blobs/" + editedBlobSha()) && method.equals("GET")) reply(exchange, 200, "{\"sha\":\"" + editedBlobSha() + "\",\"encoding\":\"base64\",\"size\":3,\"content\":\"bmV3\"}");
    else if (path.equals("/repos/owner/repo/git/trees") && method.equals("POST")) { mutations.incrementAndGet(); treeRequest = json.readTree(exchange.getRequestBody()); reply(exchange, 201, "{\"sha\":\"" + NEW_TREE + "\"}"); }
    else if (path.equals("/repos/owner/repo/git/commits") && method.equals("POST")) { mutations.incrementAndGet(); reply(exchange, 201, "{\"sha\":\"" + NEW_COMMIT + "\"}"); }
    else if (path.equals("/repos/owner/repo/git/refs/heads/main") && method.equals("PATCH")) { refUpdates.incrementAndGet(); refUpdateRequest = json.readTree(exchange.getRequestBody()); reply(exchange, 200, "{\"ref\":\"refs/heads/main\",\"object\":{\"sha\":\"" + NEW_COMMIT + "\"}}"); }
    else reply(exchange, 404, "{}");
  }

  private String rootTree() { return "{\"truncated\":false,\"tree\":[{\"path\":\"src\",\"mode\":\"040000\",\"type\":\"tree\",\"sha\":\"" + CHILD + "\"},{\"path\":\"README.md\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"" + FILE + "\"}" + (includeUnicodeFile ? ",{\"path\":\"풀이.java\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"" + FILE + "\",\"size\":3}" : "") + "]}"; }
  private String operationResultTree() {
    if (staleOperationTree || treeRequest == null) return rootTree();
    String first = treeRequest.path("tree").get(0).path("path").asText();
    if ("archive/File.java".equals(first)) return "{\"truncated\":false,\"tree\":[{\"path\":\"archive\",\"mode\":\"040000\",\"type\":\"tree\",\"sha\":\"" + CHILD + "\"},{\"path\":\"README.md\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"" + FILE + "\"}]}";
    if ("src/Archived.java".equals(first)) return "{\"truncated\":false,\"tree\":[{\"path\":\"src\",\"mode\":\"040000\",\"type\":\"tree\",\"sha\":\"" + RESULT_CHILD + "\"},{\"path\":\"README.md\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"" + FILE + "\"}]}";
    if ("src/File.java".equals(first) && treeRequest.path("tree").get(0).has("content")) return "{\"truncated\":false,\"tree\":[{\"path\":\"src\",\"mode\":\"040000\",\"type\":\"tree\",\"sha\":\"" + RESULT_CHILD + "\"},{\"path\":\"README.md\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"" + FILE + "\"}]}";
    if ("풀이.java".equals(first) && treeRequest.path("tree").get(0).path("sha").isNull()) return "{\"truncated\":false,\"tree\":[{\"path\":\"src\",\"mode\":\"040000\",\"type\":\"tree\",\"sha\":\"" + CHILD + "\"},{\"path\":\"README.md\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"" + FILE + "\"}]}";
    if ("풀이.java".equals(first)) return "{\"truncated\":false,\"tree\":[{\"path\":\"src\",\"mode\":\"040000\",\"type\":\"tree\",\"sha\":\"" + CHILD + "\"},{\"path\":\"README.md\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"" + FILE + "\"},{\"path\":\"풀이.java\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"" + editedBlobSha() + "\"}]}";
    return "{\"truncated\":false,\"tree\":[{\"path\":\"README.md\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"" + FILE + "\"}]}";
  }

  private String editedChildTree() throws IOException {
    if (treeRequest == null || !"src/File.java".equals(treeRequest.path("tree").get(0).path("path").asText()))
      return "{\"truncated\":false,\"tree\":[{\"path\":\"Archived.java\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"" + FILE + "\"}]}";
    String content = treeRequest.path("tree").get(0).path("content").asText();
    byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
    String blobSha;
    try {
      var digest = java.security.MessageDigest.getInstance("SHA-1");
      digest.update(("blob " + bytes.length + "\0").getBytes(StandardCharsets.UTF_8)); digest.update(bytes);
      blobSha = java.util.HexFormat.of().formatHex(digest.digest());
    } catch (java.security.NoSuchAlgorithmException e) { throw new IOException(e); }
    if (staleEditedTree) blobSha = FILE;
    return "{\"truncated\":false,\"tree\":[{\"path\":\"File.java\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"" + blobSha + "\",\"size\":3}]}";
  }

  private String editedBlobSha() {
    byte[] bytes = treeRequest.path("tree").get(0).path("content").asText().getBytes(StandardCharsets.UTF_8);
    try {
      var digest = java.security.MessageDigest.getInstance("SHA-1");
      digest.update(("blob " + bytes.length + "\0").getBytes(StandardCharsets.UTF_8)); digest.update(bytes);
      return java.util.HexFormat.of().formatHex(digest.digest());
    } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
  }

  private static void reply(HttpExchange exchange, int status, String body) throws IOException {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    exchange.sendResponseHeaders(status, bytes.length);
    exchange.getResponseBody().write(bytes);
    exchange.close();
  }
}
