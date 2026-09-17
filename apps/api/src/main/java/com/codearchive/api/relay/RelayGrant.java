package com.codearchive.api.relay;
import com.codearchive.api.auth.AppUser;
import jakarta.persistence.*;
import java.time.Instant;
@Entity @Table(name="relay_grants")
public class RelayGrant {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
 @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="user_id",nullable=false) private AppUser user;
 @Column(name="token_hash",nullable=false,unique=true) private String tokenHash; @Column(name="device_id",nullable=false) private String deviceId;
 private long generation; @Column(name="revoked_at") private Instant revokedAt; @Column(name="expires_at",nullable=false) private Instant expiresAt; @Column(name="created_at",nullable=false) private Instant createdAt;
 protected RelayGrant(){} public RelayGrant(AppUser user,String hash,String deviceId,long generation,Instant expiresAt){this.user=user;this.tokenHash=hash;this.deviceId=deviceId;this.generation=generation;this.expiresAt=expiresAt;this.createdAt=Instant.now();}
 public AppUser getUser(){return user;} public String getTokenHash(){return tokenHash;} public String getDeviceId(){return deviceId;} public long getGeneration(){return generation;} public boolean usable(){return revokedAt==null&&expiresAt.isAfter(Instant.now());} public void revoke(){revokedAt=Instant.now();}
}
