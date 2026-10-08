package com.codearchive.api.community;

import jakarta.persistence.*;
import com.codearchive.api.auth.AppUser;
import com.codearchive.api.solution.Solution;
import java.time.Instant;

@Entity
@Table(name = "community_comments")
public class CommunityComment {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @ManyToOne(optional = false) @JoinColumn(name = "solution_id") private Solution solution;
    @ManyToOne(optional = false) @JoinColumn(name = "user_id") private AppUser user;
    @Column(nullable = false, length = 2000) private String body;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    protected CommunityComment() {}
}
