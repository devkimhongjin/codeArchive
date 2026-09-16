package com.codearchive.api.solution;

import java.math.BigDecimal;

/** JSON shape accepted from the extension/dashboard bulk sync. Dates remain strings so one bad item does not reject the batch. */
public class CapturePayload {
    private String captureId;
    private String platform;
    private String problemNumber;
    private String title;
    private String problemUrl;
    private String language;
    private String sourceCode;
    private String result;
    private String observedAt;
    private String solvedAt;
    private BigDecimal executionTime;
    private BigDecimal memoryUsage;
    /** The value is deliberately separate from its unit: old captures are ambiguous. */
    private BigDecimal memoryValue;
    private String memoryUnit;

    public String getCaptureId() { return captureId; }
    public void setCaptureId(String captureId) { this.captureId = captureId; }
    public String getPlatform() { return platform; }
    public void setPlatform(String platform) { this.platform = platform; }
    public String getProblemNumber() { return problemNumber; }
    public void setProblemNumber(String problemNumber) { this.problemNumber = problemNumber; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getProblemUrl() { return problemUrl; }
    public void setProblemUrl(String problemUrl) { this.problemUrl = problemUrl; }
    public String getLanguage() { return language; }
    public void setLanguage(String language) { this.language = language; }
    public String getSourceCode() { return sourceCode; }
    public void setSourceCode(String sourceCode) { this.sourceCode = sourceCode; }
    public String getResult() { return result; }
    public void setResult(String result) { this.result = result; }
    public String getObservedAt() { return observedAt; }
    public void setObservedAt(String observedAt) { this.observedAt = observedAt; }
    public String getSolvedAt() { return solvedAt; }
    public void setSolvedAt(String solvedAt) { this.solvedAt = solvedAt; }
    public BigDecimal getExecutionTime() { return executionTime; }
    public void setExecutionTime(BigDecimal executionTime) { this.executionTime = executionTime; }
    public BigDecimal getMemoryUsage() { return memoryUsage; }
    public void setMemoryUsage(BigDecimal memoryUsage) { this.memoryUsage = memoryUsage; }
    public BigDecimal getMemoryValue() { return memoryValue; }
    public void setMemoryValue(BigDecimal memoryValue) { this.memoryValue = memoryValue; }
    public String getMemoryUnit() { return memoryUnit; }
    public void setMemoryUnit(String memoryUnit) { this.memoryUnit = memoryUnit; }
}
