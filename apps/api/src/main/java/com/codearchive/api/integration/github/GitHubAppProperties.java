package com.codearchive.api.integration.github;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties("codearchive.integrations.github")
public class GitHubAppProperties {
    private boolean enabled;
    private String appId = "";
    private String privateKeyPkcs8 = "";

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public String getAppId() { return appId; }
    public void setAppId(String appId) { this.appId = appId; }
    public String getPrivateKeyPkcs8() { return privateKeyPkcs8; }
    public void setPrivateKeyPkcs8(String privateKeyPkcs8) { this.privateKeyPkcs8 = privateKeyPkcs8; }
}

