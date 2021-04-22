package com.octank.demo.springbootbackend.controller;

import com.octank.demo.springbootbackend.controller.dto.FavoriteRq;
import com.octank.demo.springbootbackend.controller.dto.FavoriteRs;
import com.octank.demo.springbootbackend.model.Favorite;
import com.octank.demo.springbootbackend.repository.FavoriteRepository;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/favorite")
public class FavoriteController {

    private final FavoriteRepository favoriteRepository;

    public FavoriteController(FavoriteRepository favoriteRepository) {
        this.favoriteRepository = favoriteRepository;
    }

    @GetMapping("/")
    public List<FavoriteRs> findAll() {
        var favorite = favoriteRepository.findAll();
        return favorite
                .stream()
                .map(FavoriteRs::converter)
                .collect(Collectors.toList());
    }

    @GetMapping("/{id}")
    public FavoriteRs findById(@PathVariable("id") Long id) {
        var favorite = favoriteRepository.getOne(id);
        return FavoriteRs.converter(favorite);
    }

    @PostMapping("/")
    public void saveFavorite(@RequestBody FavoriteRq favorite) {
        var f = new Favorite();
        f.setImageUrl(favorite.getImageUrl());
        favoriteRepository.save(f);
    }

    @DeleteMapping("/{id}")
    public void deleteFavorite(@PathVariable("id") Long id) throws Exception {
        var f = favoriteRepository.findById(id);

        if(f.isPresent()) {
            favoriteRepository.deleteById(id);
        } else {
            throw new Exception("Favorite ID not found");
        }
    }
    
}
