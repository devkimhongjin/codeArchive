package com.codearchive.api.community;

import jakarta.persistence.*;
import com.codearchive.api.auth.AppUser;
import com.codearchive.api.solution.Solution;

@Entity
@Table(name = "community_likes", uniqueConstraints = @UniqueConstraint(columnNames = {"solution_id", "user_id"}))
public class CommunityLike {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @ManyToOne(optional = false) @JoinColumn(name = "solution_id") private Solution solution;
    @ManyToOne(optional = false) @JoinColumn(name = "user_id") private AppUser user;
    protected CommunityLike() {}
}
