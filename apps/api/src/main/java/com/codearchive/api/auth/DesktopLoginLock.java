package com.codearchive.api.auth;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
/** One database row serializes request allocation across API instances. */
@Entity @Table(name = "desktop_login_lock")
public class DesktopLoginLock {
    @Id private Integer id;
    protected DesktopLoginLock() {}
}
