package com.octank.demo.springbootbackend.repository;

import com.octank.demo.springbootbackend.model.Favorite;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface FavoriteRepository extends JpaRepository<Favorite, Long>{
    
}
