package com.octank.demo.springbootbackend.controller.dto;

import com.octank.demo.springbootbackend.model.Favorite;

public class FavoriteRs {

    private Long id;
    private String imageUrl;

    public static FavoriteRs converter(Favorite f) {
        var favorite = new FavoriteRs();
        favorite.setId(f.getId());
        favorite.setImageUrl(f.getImageUrl());;
        return favorite;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getImageUrl() {
        return imageUrl;
    }

    public void setImageUrl(String imageUrl) {
        this.imageUrl = imageUrl;
    }
    
}
